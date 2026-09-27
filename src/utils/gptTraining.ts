import type { SpellingSession, SpellingTrace } from './spellingPractice'

export type TrainingItem = {
  itemId: string
  word: string
  dictionaryId: string
  sourceType: 'ielts_mock_error' | 'repeated_spelling_error' | 'spaced_review_due' | 'custom'
  sourceRef?: string
  priority: number
  order?: number
  originalIndex: number
}
export type TrainingTask = {
  schemaVersion: 1
  planId: string
  taskId: string
  title: string
  scheduledDate: string
  priority: number
  items: TrainingItem[]
}
export type TrainingContext = { task: TrainingTask; sessionId: string }
export const trainingSources = {
  ielts_mock_error: 'IELTS 模考错词',
  repeated_spelling_error: '近期重复拼错词',
  spaced_review_due: '艾宾浩斯到期词',
  custom: '自定义训练',
}

function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} 含未知字段`)
  return value as Record<string, unknown>
}
function string(value: unknown, label: string, max = 128, id = false): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || (id && !/^[A-Za-z0-9_.-]+$/.test(value)))
    throw new Error(`${label} 无效`)
  return value.trim()
}
function priority(value: unknown): number {
  if (value === undefined) return 50
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new Error('priority 必须是 0–100 的整数')
  return value
}
export function trainingDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function parseTrainingTask(input: unknown): TrainingTask {
  const task = object(input, ['schemaVersion', 'planId', 'taskId', 'title', 'scheduledDate', 'priority', 'items'], '任务')
  if (task.schemaVersion !== 1) throw new Error('不支持的 schemaVersion（需要 1）')
  const scheduledDate = string(task.scheduledDate, 'scheduledDate', 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) ||
    !Number.isFinite(Date.parse(scheduledDate)) ||
    new Date(scheduledDate).toISOString().slice(0, 10) !== scheduledDate
  )
    throw new Error('scheduledDate 不是有效日期')
  if (!Array.isArray(task.items) || !task.items.length || task.items.length > 300) throw new Error('items 必须包含 1–300 个词')
  const ids = new Set<string>(),
    words = new Set<string>(),
    orders = new Set<number>()
  const items = task.items.map((value, originalIndex): TrainingItem => {
    const row = object(
      value,
      ['itemId', 'word', 'dictionaryId', 'sourceType', 'sourceRef', 'priority', 'order'],
      `词条 ${originalIndex + 1}`,
    )
    const itemId = string(row.itemId, 'itemId', 128, true)
    const word = string(row.word, 'word', 200)
    const dictionaryId = string(row.dictionaryId, 'dictionaryId', 128, true)
    const key = `${dictionaryId}\0${word.toLowerCase()}`
    if (ids.has(itemId) || words.has(key)) throw new Error(`重复词条：${itemId} / ${word}`)
    ids.add(itemId)
    words.add(key)
    if (typeof row.sourceType !== 'string' || !Object.prototype.hasOwnProperty.call(trainingSources, row.sourceType))
      throw new Error(`来源类型无效：${itemId}`)
    let order: number | undefined
    if (row.order !== undefined) {
      if (typeof row.order !== 'number' || !Number.isSafeInteger(row.order) || row.order < 1 || orders.has(row.order))
        throw new Error('order 必须是互不重复的正整数')
      order = row.order
      orders.add(order)
    }
    return {
      itemId,
      word,
      dictionaryId,
      sourceType: row.sourceType as TrainingItem['sourceType'],
      ...(row.sourceRef === undefined ? {} : { sourceRef: string(row.sourceRef, 'sourceRef', 500) }),
      priority: priority(row.priority),
      ...(order === undefined ? {} : { order }),
      originalIndex,
    }
  })
  if (orders.size && orders.size !== items.length) throw new Error('order 必须全部填写或全部省略')
  items.sort((a, b) => (orders.size ? a.order! - b.order! : b.priority - a.priority || a.originalIndex - b.originalIndex))
  return {
    schemaVersion: 1,
    planId: string(task.planId, 'planId', 128, true),
    taskId: string(task.taskId, 'taskId', 128, true),
    title: string(task.title, 'title', 200),
    scheduledDate,
    priority: priority(task.priority),
    items,
  }
}

export function trainingWordContext(context: TrainingContext, index: number) {
  const item = context.task.items[index]
  if (!item) throw new Error('训练词条索引无效')
  return {
    schemaVersion: 1,
    planId: context.task.planId,
    taskId: context.task.taskId,
    sessionId: context.sessionId,
    ...item,
    trainingIndex: index,
  }
}

export function summarizeTraining(
  task: TrainingTask,
  traces: SpellingTrace[],
  session: Pick<SpellingSession, 'deferred' | 'pending' | 'activeRetry' | 'interrupted'>,
  ended: boolean,
) {
  // Prefer a later/more complete trace of the same presentation (including resumed drafts).
  const unique = new Map<string, SpellingTrace>()
  for (const trace of [...session.interrupted, ...traces]) {
    const previous = unique.get(trace.exposureId)
    if (
      !previous ||
      trace.outcome === 'completed' ||
      (previous.outcome !== 'completed' && trace.attempts.length >= previous.attempts.length)
    )
      unique.set(trace.exposureId, trace)
  }
  const items = task.items.map((item, index) => {
    const exposures = Array.from(unique.values()).filter((trace) => trace.sourceIndex === index)
    const attempts = exposures.flatMap((trace) => trace.attempts.concat(trace.activeAttempt?.keys?.length ? [trace.activeAttempt] : []))
    const successfulAttempts = attempts.filter((attempt) => attempt.outcome === 'correct').length
    const failedAttempts = attempts.filter((attempt) => attempt.outcome === 'error').length
    const first = exposures
      .filter((trace) => trace.kind === 'main')
      .flatMap((trace) => trace.attempts)
      .find((attempt) => attempt.outcome !== 'interrupted')
    const mainCompleted = exposures.some((trace) => trace.kind === 'main' && trace.outcome === 'completed')
    const key = `${item.dictionaryId}\0${item.word.toLowerCase()}`
    return {
      ...item,
      trainingIndex: index,
      mainCompleted,
      unanswered: !attempts.length,
      skipped: ended && !mainCompleted,
      firstAttemptCorrect: first ? first.outcome === 'correct' : null,
      successfulAttempts,
      failedAttempts,
      interruptedAttempts: attempts.filter((attempt) => attempt.outcome === 'interrupted').length,
      attemptAccuracy: successfulAttempts + failedAttempts ? successfulAttempts / (successfulAttempts + failedAttempts) : null,
      activeDurationMs: attempts.reduce((sum, attempt) => sum + (attempt.durationMs || 0), 0),
      firstKeyDelayMs: attempts.map((attempt) => attempt.firstKeyDelayMs ?? null),
      errorPositions: exposures.flatMap((trace) =>
        trace.attempts
          .filter((attempt) => attempt.error)
          .map((attempt) => ({ exposureId: trace.exposureId, attempt: attempt.number, ...attempt.error })),
      ),
      retryCount: exposures.filter((trace) => trace.kind === 'retry').length,
      retryCompletedCount: exposures.filter((trace) => trace.kind === 'retry' && trace.outcome === 'completed').length,
      retryDeferred: session.deferred.includes(key),
      answerRevealed: attempts.some((attempt) => attempt.answerRevealed),
    }
  })
  const mainListCompleted = items.every((item) => item.mainCompleted)
  const retryQueueResolved = session.deferred.length === 0 && session.pending.length === 0 && !session.activeRetry
  const entireTaskCompleted = ended && mainListCompleted && retryQueueResolved
  return {
    items,
    mainListCompleted,
    retryQueueResolved,
    entireTaskCompleted,
    sessionEnded: ended,
    incompleteItemIds: items.filter((item) => !item.mainCompleted || item.retryDeferred).map((item) => item.itemId),
  }
}
