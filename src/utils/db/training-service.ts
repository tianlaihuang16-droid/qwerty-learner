import { db } from '.'
import { isDataRestoring, runStudyWrite } from './maintenance'
import { ReviewRecord } from './record'
import type { IWordRecord, ReviewWord } from './record'
import { withoutBlacklistedWords, wordFeedbackMap } from './word-feedback'
import type { TypingState } from '@/pages/Typing/store/type'
import { idDictionaryMap } from '@/resources/dictionary'
import { enqueueCloudWrite, isDesktopSync } from '@/utils/cloudQueue'
import { parseTrainingTask, summarizeTraining, trainingDate, trainingWordContext } from '@/utils/gptTraining'
import type { TrainingContext, TrainingTask } from '@/utils/gptTraining'
import type { SpellingTrace } from '@/utils/spellingPractice'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { invoke } from '@tauri-apps/api/tauri'

export type TrainingRun = {
  sessionId: string
  taskId: string
  context: TrainingContext
  reviewId: number
  status: 'in_progress' | 'paused' | 'completed' | 'incomplete'
  updatedAt: string
  revision: number
  traces: Record<string, { trace: SpellingTrace; recordId: number }>
  snapshot?: TypingState
  result?: ReturnType<typeof summarizeTraining>
}
export type TrainingOutbox = { eventId: string; date: string; kind: 'word' | 'training-task'; event: Record<string, unknown> }
export type TaskEntry = { task: TrainingTask; run?: TrainingRun; error?: string; notice?: string }
export const isRunEnded = (run: TrainingRun) => run.status === 'completed' || run.status === 'incomplete'

export async function listTrainingTasks(): Promise<{ entries: TaskEntry[]; errors: string[] }> {
  const errors: string[] = []
  const entries = new Map<string, TaskEntry>()
  const feedbackByKey = wordFeedbackMap(await db.wordFeedback.toArray())
  if (isDesktopSync()) {
    const files = await invoke<{ files: { name: string; content?: string; error?: string }[]; errors: string[] }>(
      'read_cloud_training_tasks',
    )
    errors.push(...files.errors)
    for (const file of files.files) {
      try {
        if (file.error) throw new Error(file.error)
        const task = parseTrainingTask(JSON.parse(file.content || ''))
        const old = entries.get(task.taskId)
        if (old && JSON.stringify(old.task) !== JSON.stringify(task)) old.error = '相同 taskId 的文件内容冲突，请使用新的 taskId'
        else if (!old) entries.set(task.taskId, { task })
      } catch (error) {
        errors.push(`${file.name}: ${String(error)}`)
      }
    }
  }
  for (const run of (await db.trainingRuns.toArray()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    const entry = entries.get(run.taskId)
    if (!entry) entries.set(run.taskId, { task: run.context.task, run })
    else {
      entry.run = run
      if (JSON.stringify(entry.task) !== JSON.stringify(run.context.task)) {
        entry.error = '文件已修改；继续使用已开始的任务快照。调整任务请使用新的 taskId。'
        entry.task = run.context.task
      }
    }
  }
  for (const entry of Array.from(entries.values())) {
    if (entry.run && !isRunEnded(entry.run)) continue
    const items = withoutBlacklistedWords(entry.task.items, feedbackByKey)
    const excluded = entry.task.items.length - items.length
    if (!excluded) continue
    entry.task = { ...entry.task, items }
    entry.notice = `已排除 ${excluded} 个拉黑词`
    if (!items.length) entry.error = '任务中的词已全部拉黑'
  }
  return {
    entries: Array.from(entries.values()).sort(
      (a, b) =>
        Number(!!a.run && isRunEnded(a.run)) - Number(!!b.run && isRunEnded(b.run)) ||
        a.task.scheduledDate.localeCompare(b.task.scheduledDate) ||
        b.task.priority - a.task.priority ||
        a.task.taskId.localeCompare(b.task.taskId),
    ),
    errors,
  }
}

async function resolveWords(task: TrainingTask): Promise<ReviewWord[]> {
  const dictionaries = new Map<string, Awaited<ReturnType<typeof wordListFetcher>>>()
  for (const id of Array.from(new Set(task.items.map((item) => item.dictionaryId)))) {
    const dict = idDictionaryMap[id]
    if (!dict) throw new Error(`找不到词库：${id}`)
    dictionaries.set(id, await wordListFetcher(dict.url))
  }
  return task.items.map((item) => {
    const matches = dictionaries.get(item.dictionaryId)!.filter((word) => word.name.trim().toLowerCase() === item.word.toLowerCase())
    if (matches.length !== 1)
      throw new Error(`${item.itemId}: ${item.dictionaryId} 中${matches.length ? '存在重复词' : '找不到'} ${item.word}`)
    return { ...matches[0], sourceDict: item.dictionaryId }
  })
}

async function addRunEvent(run: TrainingRun, type: string) {
  const eventId = `training:${run.sessionId}:${run.revision}:${type}`
  await db.trainingOutbox.put({
    eventId,
    date: trainingDate(),
    kind: 'training-task',
    event: {
      eventId,
      recordedAt: run.updatedAt,
      schemaVersion: 1,
      type,
      planId: run.context.task.planId,
      taskId: run.taskId,
      sessionId: run.sessionId,
      revision: run.revision,
      title: run.context.task.title,
      status: run.status,
      ...(run.result || {}),
    },
  })
}

export async function startTrainingTask(task: TrainingTask, restart = false): Promise<ReviewRecord> {
  const existing = (await db.trainingRuns.where('taskId').equals(task.taskId).toArray()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0]
  if (existing && !restart) {
    if (isRunEnded(existing)) throw new Error('本次训练已结束，请使用重新训练')
    const record = await db.reviewRecords.get(existing.reviewId)
    if (!record) throw new Error('训练快照缺失，请恢复有效备份')
    return { ...record, isFinished: false } as ReviewRecord
  }
  if (task.scheduledDate > trainingDate()) throw new Error('尚未到计划训练日期')
  const feedbackByKey = wordFeedbackMap(await db.wordFeedback.toArray())
  const items = withoutBlacklistedWords(task.items, feedbackByKey)
  if (!items.length) throw new Error('任务中的词已全部拉黑')
  const effectiveTask = items.length === task.items.length ? task : { ...task, items }
  const words = await resolveWords(effectiveTask)
  return runStudyWrite(async () => {
    const record = await db.transaction('rw', db.reviewRecords, db.trainingRuns, db.trainingOutbox, async () => {
      const active = (await db.trainingRuns.where('taskId').equals(task.taskId).toArray()).find((run) => !isRunEnded(run))
      if (active) {
        const saved = await db.reviewRecords.get(active.reviewId)
        if (!saved) throw new Error('训练快照缺失')
        return { ...saved, isFinished: false } as ReviewRecord
      }
      const context: TrainingContext = { task: effectiveTask, sessionId: crypto.randomUUID() }
      const created = new ReviewRecord(`gpt-training-${context.sessionId}`, words, 'gpt')
      created.gptTraining = context
      created.id = await db.reviewRecords.add(created)
      const run: TrainingRun = {
        sessionId: context.sessionId,
        taskId: task.taskId,
        context,
        reviewId: created.id,
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
        revision: 0,
        traces: {},
      }
      await db.trainingRuns.add(run)
      await addRunEvent(run, 'started')
      return created
    })
    void flushTrainingOutbox()
    return record
  })
}

// Reserve one record for an exposure before applying its scheduling decision.
export async function saveTrainingWord(
  context: TrainingContext,
  record: IWordRecord,
  trace: SpellingTrace,
): Promise<{ recordId: number; inserted: boolean; pending: boolean; record?: IWordRecord }> {
  return db.transaction('rw', db.wordRecords, db.trainingRuns, async () => {
    const run = await db.trainingRuns.get(context.sessionId)
    if (!run || isRunEnded(run)) throw new Error('任务运行不存在或已经结束')
    const previous = run.traces[trace.exposureId]
    if (previous) {
      const savedRecord = await db.wordRecords.get(previous.recordId)
      if (!savedRecord) throw new Error('训练记录缺失')
      return { recordId: previous.recordId, inserted: false, pending: savedRecord.spacedReviewPending === true, record: savedRecord }
    }
    record.spacedReviewPending = true
    const recordId = await db.wordRecords.add(record)
    run.traces[trace.exposureId] = { trace, recordId }
    await db.trainingRuns.put(run)
    return { recordId, inserted: true, pending: true, record }
  })
}

// Publish only after the same decision used for the review state is stored on the word record.
export async function publishTrainingWord(context: TrainingContext, record: IWordRecord, trace: SpellingTrace, recordId: number) {
  await db.transaction('rw', db.wordRecords, db.trainingOutbox, async () => {
    if (!record.spacedReviewDecision) throw new Error('复习调度决策尚未保存')
    if (!(await db.wordRecords.update(recordId, { spacedReviewDecision: record.spacedReviewDecision, spacedReviewPending: false })))
      throw new Error('训练记录不存在')
    const eventId = `training-word:${context.sessionId}:${trace.exposureId}`
    await db.trainingOutbox.put({
      eventId,
      date: trainingDate(),
      kind: 'word',
      event: {
        ...record,
        spacedReviewPending: false,
        recordId,
        eventId,
        recordedAt: new Date().toISOString(),
        gptTraining: trainingWordContext(context, trace.sourceIndex),
        durationMs: trace.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      },
    })
  })
  void flushTrainingOutbox()
}

export async function saveTrainingProgress(context: TrainingContext, snapshot: TypingState, pause = false) {
  if (isDataRestoring() || !snapshot.chapterData.words.length) return
  const ended = snapshot.isFinished && !snapshot.isSavingRecord
  return runStudyWrite(async () => {
    await db.transaction('rw', db.trainingRuns, db.trainingOutbox, async () => {
      const run = await db.trainingRuns.get(context.sessionId)
      if (!run || isRunEnded(run)) return
      const traces = Object.values(run.traces).map((entry) => entry.trace)
      if (snapshot.spellingDraft) traces.push(snapshot.spellingDraft)
      run.result = summarizeTraining(context.task, traces, snapshot.spellingSession, ended)
      const previousStatus = run.status
      run.status = ended
        ? run.result.entireTaskCompleted
          ? 'completed'
          : 'incomplete'
        : pause || !snapshot.isTyping
        ? 'paused'
        : 'in_progress'
      run.snapshot = snapshot
      run.updatedAt = new Date().toISOString()
      run.revision++
      await db.trainingRuns.put(run)
      if (ended || run.status !== previousStatus || pause) await addRunEvent(run, ended ? 'ended' : run.status)
    })
    void flushTrainingOutbox()
  })
}

let transferring: Promise<void> | undefined
export function flushTrainingOutbox(): Promise<void> {
  if (transferring) return transferring
  if (!isDesktopSync() || isDataRestoring()) return Promise.resolve()
  transferring = (async () => {
    for (;;) {
      if (isDataRestoring()) return
      const row = await db.trainingOutbox.orderBy('eventId').first()
      if (!row) return
      await enqueueCloudWrite(`event:${row.eventId}`, 'append_cloud_study_event', { kind: row.kind, date: row.date, event: row.event })
      await db.trainingOutbox.delete(row.eventId)
    }
  })()
    .catch((error) => console.error('训练结果保留在本机，稍后重试', error))
    .finally(() => {
      transferring = undefined
    })
  return transferring
}
