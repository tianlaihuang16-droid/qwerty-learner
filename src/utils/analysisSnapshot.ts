import { analyzeBehavior } from './behaviorAnalysis'
import { isDesktopSync } from './cloudQueue'
import { reportCloudSyncError } from './cloudSync'
import { flushTypingProgress } from './typingProgress'
import { db, spacedReviewDb } from './db'
import { resumeStudyWritesAfterAnalysisCloseFailure, settleStudyWritesForClose } from './db/maintenance'
import { wordLearningIdentity } from './db/word-learning-identity'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'

type NativeSources = { logs: Record<string, unknown>[]; chapterLogs: Record<string, unknown>[];
  // Native JSON can contain older session shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentSession?: Record<string, any>; logQuality: Record<string, number> }
const preparations = new Set<() => Promise<unknown>>()
let generating: Promise<void> | undefined
let closing = false
let sourcesReady = false
let sessionStartedAt = 0
let startingRecordId = 0

export function registerAnalysisClosePreparation(prepare: () => Promise<unknown>) {
  preparations.add(prepare)
  return () => { preparations.delete(prepare) }
}

function unfinishedSessions() {
  const result: Record<string, unknown>[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith('qwertyTypingProgress:v1:')) continue
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '')
      const session = stored.snapshot?.spellingSession
      if (!session || typeof session.id !== 'string') continue
      result.push({ sessionId: session.id, dictionaryId: stored.dictId, internalSlice: stored.chapter,
        pending: session.pending, deferred: session.deferred, activeRetry: session.activeRetry,
        interrupted: session.interrupted, draft: stored.snapshot.spellingDraft ?? null, source: 'localStorage-progress' })
    } catch { /* A damaged optional progress snapshot must not block analysis. */ }
  }
  return result.sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)))
}

async function generateSnapshot() {
  // A single read transaction keeps the three RecordDB tables at one boundary.
  const [rows, currentStates] = await Promise.all([
    db.transaction('r', db.wordRecords, db.chapterRecords, db.reviewRecords, db.trainingRuns, async () => ({
      records: await db.wordRecords.toArray(), chapters: await db.chapterRecords.toArray(),
      reviewRecords: await db.reviewRecords.toArray(), trainingRuns: await db.trainingRuns.toArray(),
    })),
    spacedReviewDb.wordStates.toArray(),
  ])
  const sources = await invoke<NativeSources>('read_analysis_sources')
  const unfinished = unfinishedSessions()
  for (const run of rows.trainingRuns) {
    const draft = run.snapshot?.spellingDraft
    if (!draft) continue
    const taskItem = run.context.task.items[draft.sourceIndex]
    const dictionaryId = taskItem?.dictionaryId ?? run.snapshot?.chapterData.words[draft.sourceIndex]?.sourceDict
    if (!dictionaryId) continue
    unfinished.push({ sessionId: run.sessionId, dictionaryId, savedAt: run.updatedAt, draft,
      pending: run.snapshot?.spellingSession.pending, deferred: run.snapshot?.spellingSession.deferred,
      interrupted: run.snapshot?.spellingSession.interrupted, activeRetry: run.snapshot?.spellingSession.activeRetry,
      taskId: run.taskId, status: run.status, source: 'training-run-snapshot' })
  }
  const current = sources.currentSession
  if (current?.spellingSession?.id && !unfinished.some(session => session.sessionId === current.spellingSession.id)) {
    unfinished.push({ sessionId: current.spellingSession.id, dictionaryId: current.dictionaryId,
      savedAt: current.savedAt, draft: current.spellingDraft ?? null, pending: current.spellingSession.pending,
      deferred: current.spellingSession.deferred, interrupted: current.spellingSession.interrupted,
      activeRetry: current.spellingSession.activeRetry, source: 'cloud-current-session' })
  }
  const analysisInput = { ...rows, states: currentStates, logs: sources.logs, chapterLogs: sources.chapterLogs,
    logQuality: sources.logQuality, unfinishedSessions: unfinished } as unknown as Parameters<typeof analyzeBehavior>[0]
  const analysis = analyzeBehavior(analysisInput, wordLearningIdentity, new Date().toISOString())
  await invoke('write_analysis_snapshot', { analysis })
}

function generateOnce() {
  if (!generating) generating = generateSnapshot().finally(() => { generating = undefined })
  return generating
}

async function prepareAndClose() {
  if (closing) return
  closing = true
  try {
    const prepared = await Promise.allSettled(Array.from(preparations).map(prepare => prepare()))
    const failed = prepared.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    flushTypingProgress()
    await settleStudyWritesForClose()
    if (failed) throw failed.reason
    const newPracticeCount = await db.wordRecords.where(':id').above(startingRecordId)
      .and((record) => record.timeStamp >= sessionStartedAt).count()
    if (newPracticeCount > 50) {
      if (!sourcesReady) throw new Error('学习数据尚未加载完成，请稍后重试')
      if (generating) await generating
      await generateOnce()
    }
    await invoke('finish_analysis_close')
  } catch (error) {
    console.error('Failed to prepare desktop close; the window remains open', error)
    void reportCloudSyncError('analysis-snapshot', error)
    resumeStudyWritesAfterAnalysisCloseFailure()
    closing = false
    await invoke('cancel_analysis_close').catch((closeError) => console.error('Failed to cancel desktop close', closeError))
    await invoke('show_analysis_close_error', { message: String(error) })
  }
}

export async function startAnalysisSnapshotLifecycle() {
  if (!isDesktopSync()) return
  sessionStartedAt = Math.floor(Date.now() / 1000)
  const lastRecord = await db.wordRecords.orderBy(':id').last()
  startingRecordId = (lastRecord as typeof lastRecord & { id?: number })?.id ?? 0
  await listen('analysis-close-requested', () => { void prepareAndClose() })
  await invoke('enable_analysis_close_handler')
}

export function markAnalysisSourcesReady() { sourcesReady = true }
