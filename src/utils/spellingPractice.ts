export type AnswerVisibility = 'full' | 'partial' | 'hidden'
export type SpellingKey = { key: string; position: number; activeAtMs: number; visibility: AnswerVisibility; targetVisible: boolean }
export type SpellingAttempt = {
  number: number
  // Older attempts have no reliable audio-end timing basis.
  timingBasis?: 'after-pronunciation'
  input: string
  outcome: 'correct' | 'error' | 'interrupted'
  firstKeyDelayMs: number | null
  durationMs: number
  keys: SpellingKey[]
  error?: { position: number; expected: string; actual: string; isSlip?: boolean }
  answerRevealed: boolean
}
export type SpellingTrace = {
  version: 1
  // Wall-clock Unix seconds at exposure creation; retained when a draft is resumed.
  startedAt?: number
  exposureId: string
  sessionId: string
  sourceIndex: number
  word: string
  kind: 'main' | 'retry'
  retryNumber: number
  outcome: 'completed' | 'interrupted'
  completedAtMs?: number
  attempts: SpellingAttempt[]
  activeAttempt: SpellingAttempt
}

const emptyAttempt = (number: number): SpellingAttempt => ({
  number,
  timingBasis: 'after-pronunciation',
  input: '',
  outcome: 'interrupted',
  firstKeyDelayMs: null,
  durationMs: 0,
  keys: [],
  answerRevealed: false,
})

// The clock advances only during active, focused practice. No background key listener.
export class SpellingRecorder {
  private elapsed = 0
  private runningSince: number | undefined
  private attemptStart = 0
  readonly trace: SpellingTrace
  constructor(
    trace: Omit<SpellingTrace, 'version' | 'outcome' | 'attempts' | 'activeAttempt'>,
    private clock = () => performance.now(),
    restored?: SpellingTrace,
  ) {
    const startedAt = restored?.exposureId === trace.exposureId
      ? restored.startedAt
      : trace.startedAt ?? Date.now() / 1000
    this.trace = { ...trace, startedAt, version: 1, outcome: 'interrupted', attempts: [], activeAttempt: emptyAttempt(1) }
    if (restored?.exposureId === trace.exposureId) {
      this.trace.attempts = structuredClone(restored.attempts)
      if (restored.activeAttempt.keys.length)
        this.trace.attempts.push({ ...structuredClone(restored.activeAttempt), outcome: 'interrupted' })
      this.trace.activeAttempt = emptyAttempt(this.trace.attempts.length + 1)
    }
  }
  private now() {
    return this.elapsed + (this.runningSince === undefined ? 0 : Math.max(0, this.clock() - this.runningSince))
  }
  setActive(active: boolean) {
    if (active && this.runningSince === undefined) this.runningSince = this.clock()
    if (!active && this.runningSince !== undefined) {
      this.elapsed = this.now()
      this.runningSince = undefined
    }
  }
  reveal() {
    this.trace.activeAttempt.answerRevealed = true
  }
  markLastErrorAsSlip() {
    const last = [...this.trace.attempts].reverse().find((attempt) => attempt.error)
    if (!last?.error || last.error.isSlip) return false
    last.error.isSlip = true
    return true
  }
  key(
    key: string,
    expected: string,
    correct: boolean,
    visibility: AnswerVisibility,
    finished: boolean,
    targetVisible = visibility === 'full',
  ) {
    const attempt = this.trace.activeAttempt
    const time = Math.round(this.now() - this.attemptStart)
    if (!attempt.keys.length) attempt.firstKeyDelayMs = time
    attempt.keys.push({ key, position: attempt.input.length, activeAtMs: time, visibility, targetVisible })
    attempt.input += key
    attempt.durationMs = time
    if (!correct || finished) {
      attempt.outcome = correct ? 'correct' : 'error'
      if (!correct) attempt.error = { position: attempt.input.length - 1, expected, actual: key }
      this.trace.attempts.push(structuredClone(attempt))
      this.trace.activeAttempt = emptyAttempt(this.trace.attempts.length + 1)
      this.attemptStart = this.now()
      if (finished && correct) {
        this.trace.outcome = 'completed'
        this.trace.completedAtMs = Date.now()
      }
    }
  }
  draftKey(key: string, visibility: AnswerVisibility, targetVisible = visibility === 'full') {
    const attempt = this.trace.activeAttempt
    const time = Math.round(this.now() - this.attemptStart)
    if (!attempt.keys.length) attempt.firstKeyDelayMs = time
    attempt.keys.push({ key, position: attempt.input.length, activeAtMs: time, visibility, targetVisible })
    attempt.input += key
    attempt.durationMs = time
  }
  backspaceDraft() {
    const attempt = this.trace.activeAttempt
    if (!attempt.input.length) return
    attempt.input = attempt.input.slice(0, -1)
    attempt.keys.pop()
    attempt.durationMs = attempt.keys.at(-1)?.activeAtMs ?? 0
    if (!attempt.keys.length) attempt.firstKeyDelayMs = null
  }
  finishDraft(correct: boolean, expected: string, mismatchIndex: number) {
    const attempt = this.trace.activeAttempt
    const time = Math.round(this.now() - this.attemptStart)
    attempt.durationMs = time
    attempt.outcome = correct ? 'correct' : 'error'
    if (!correct) {
      attempt.error = {
        position: mismatchIndex,
        expected: expected[mismatchIndex] ?? '',
        actual: attempt.input[mismatchIndex] ?? '',
      }
    }
    this.trace.attempts.push(structuredClone(attempt))
    this.trace.activeAttempt = emptyAttempt(this.trace.attempts.length + 1)
    this.attemptStart = this.now()
    if (correct) {
      this.trace.outcome = 'completed'
      this.trace.completedAtMs = Date.now()
    }
  }
  startNextAttempt() {
    this.attemptStart = this.now()
  }
  snapshot(): SpellingTrace {
    const trace = structuredClone(this.trace)
    if (trace.activeAttempt.keys.length) trace.activeAttempt.durationMs = Math.round(this.now() - this.attemptStart)
    return trace
  }
}

export type RetryItem = { index: number; key: string; intervening: string[] }
export type SpellingSession = {
  version: 1
  id: string
  mainCursor: number
  loopCompleted: number
  activeRetry: RetryItem | null
  pending: RetryItem[]
  retryCounts: Record<string, number>
  retryCompleted: number
  deferred: string[]
  interrupted: SpellingTrace[]
}
export type PracticeWord = { name: string; sourceDict?: string }
export const practiceWordKey = (word: PracticeWord) => `${word.sourceDict ?? ''}\u0000${word.name.toLowerCase()}`
export function newSpellingSession(index = 0): SpellingSession {
  return {
    version: 1,
    id: crypto.randomUUID(),
    mainCursor: index,
    loopCompleted: 0,
    activeRetry: null,
    pending: [],
    retryCounts: {},
    retryCompleted: 0,
    deferred: [],
    interrupted: [],
  }
}

function enqueueRetry(session: SpellingSession, index: number, key: string) {
  if ((session.retryCounts[key] ?? 0) >= 2) {
    if (!session.deferred.includes(key)) session.deferred.push(key)
  } else if (!session.pending.some((item) => item.key === key)) {
    session.pending.push({ index, key, intervening: [] })
  }
}

function selectNext(session: SpellingSession, length: number) {
  const ready = session.pending.findIndex((item) => item.intervening.length >= 3)
  if (ready >= 0) {
    session.activeRetry = session.pending.splice(ready, 1)[0]
    const key = session.activeRetry.key
    session.retryCounts[key] = (session.retryCounts[key] ?? 0) + 1
    return { index: session.activeRetry.index, finished: false }
  }
  session.activeRetry = null
  if (session.mainCursor < length) return { index: session.mainCursor, finished: false }
  for (const item of session.pending) if (!session.deferred.includes(item.key)) session.deferred.push(item.key)
  return { index: Math.max(0, length - 1), finished: true }
}

// Called after one fully corrected presentation, rather than after each keystroke.
export function completeSpellingWord(
  session: SpellingSession,
  words: PracticeWord[],
  index: number,
  wrongCount: number,
  loopTimes: number,
) {
  const key = practiceWordKey(words[index])
  const wasRetry = session.activeRetry !== null
  for (const item of session.pending) {
    if (item.key !== key && !item.intervening.includes(key)) item.intervening.push(key)
  }
  if (wrongCount > 0) enqueueRetry(session, index, key)
  if (wasRetry) {
    session.retryCompleted++
    session.activeRetry = null
  } else {
    session.loopCompleted++
    if (session.loopCompleted < Math.max(1, loopTimes)) return { index, finished: false }
    session.loopCompleted = 0
    session.mainCursor = index + 1
  }
  return selectNext(session, words.length)
}

export function skipSpellingWord(session: SpellingSession, words: PracticeWord[], index: number) {
  const key = practiceWordKey(words[index])
  if (!session.deferred.includes(key)) session.deferred.push(key)
  if (session.activeRetry) {
    session.activeRetry = null
  } else {
    session.mainCursor = index + 1
    session.loopCompleted = 0
  }
  return selectNext(session, words.length)
}

export function spellingEvidence(trace: SpellingTrace) {
  const positions = trace.attempts.flatMap((attempt) => (attempt.error ? [attempt.error.position] : []))
  return {
    label:
      positions.length === 0
        ? 'no-observed-error'
        : new Set(positions).size > 1
        ? 'multiple-error-positions'
        : positions.length > 1
        ? 'repeated-error-position'
        : 'single-observed-error',
    errorPositions: positions,
    inferenceOnly: true,
  }
}
