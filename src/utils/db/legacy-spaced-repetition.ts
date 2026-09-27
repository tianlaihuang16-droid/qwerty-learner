import type {
  ISpacedReviewDecision, ISpacedReviewState, IWordRecord, SpacedReviewDueAtStart, SpacedReviewEvidence,
  SpacedReviewRating, SpacedReviewReason,
} from './record'
import type { WordLearningIdentity } from './word-learning-identity'
import { mergeSourceDicts } from './word-learning-identity'

// Modified Ebbinghaus intervals. Short early reviews protect new and failed words;
// later stages expand to four months after repeated successful recall.
export const EBBINGHAUS_INTERVAL_MINUTES = [
  10,
  12 * 60,
  24 * 60,
  2 * 24 * 60,
  4 * 24 * 60,
  7 * 24 * 60,
  15 * 24 * 60,
  30 * 24 * 60,
  60 * 24 * 60,
  120 * 24 * 60,
]
export const SPACED_REVIEW_ALGORITHM = 'modified-ebbinghaus-v7-evidence'

function scheduledReviewAt(timeStamp: number, intervalMinutes: number) {
  return timeStamp + intervalMinutes * 60
}

type ReviewInput = Pick<IWordRecord, 'word' | 'dict' | 'timeStamp' | 'wrongCount' | 'timing'> &
  Pick<Partial<IWordRecord>, 'spelling'>

function exposureStartEvidence(record: ReviewInput): { startedAt?: number; exact: boolean } {
  const trace = record.spelling
  if (!trace) return { exact: false }
  if (typeof trace.startedAt === 'number' && Number.isFinite(trace.startedAt) &&
      trace.startedAt <= record.timeStamp + 1) {
    return { startedAt: trace.startedAt, exact: true }
  }
  // Old traces have active time only. The record timestamp is floored, so its
  // full one-second uncertainty must be included in the latest possible start.
  // Pauses and background time can only make the real start earlier.
  if (trace.outcome !== 'completed' || !Array.isArray(trace.attempts) || trace.attempts.length === 0 ||
      !trace.attempts.every((attempt) => attempt.outcome !== 'interrupted' &&
        typeof attempt.durationMs === 'number' && Number.isFinite(attempt.durationMs) && attempt.durationMs >= 0)) {
    return { exact: false }
  }
  const activeDurationMs = trace.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)
  return { startedAt: record.timeStamp + 1 - activeDurationMs / 1000, exact: false }
}

function dueAtExposureStart(
  deadline: number,
  start: ReturnType<typeof exposureStartEvidence>,
): SpacedReviewDueAtStart {
  if (start.startedAt === undefined) return 'unknown'
  if (start.startedAt < deadline) return 'early'
  return start.exact ? 'due' : 'unknown'
}

export function classifySpacedReviewEvidence(record: ReviewInput): {
  kind: SpacedReviewEvidence
  firstKeyDelayMs?: number
  typingDurationMs?: number
} {
  const trace = record.spelling
  if (!trace || trace.version !== 1 || !Array.isArray(trace.attempts)) return { kind: 'unknown' }
  const first = trace.attempts[0]
  const firstKeyDelayMs =
    typeof first?.firstKeyDelayMs === 'number' && Number.isFinite(first.firstKeyDelayMs) && first.firstKeyDelayMs >= 0
      ? first.firstKeyDelayMs
      : undefined
  const typingDurationMs =
    firstKeyDelayMs !== undefined && typeof first.durationMs === 'number' && Number.isFinite(first.durationMs) &&
    first.durationMs >= firstKeyDelayMs
      ? first.durationMs - firstKeyDelayMs
      : undefined
  const times = { firstKeyDelayMs, typingDurationMs }
  if (trace.kind === 'retry') return { kind: 'retry', ...times }
  if (trace.kind !== 'main' || trace.outcome !== 'completed' || trace.attempts.length === 0) {
    return { kind: 'unknown', ...times }
  }
  const hasAssistance = trace.attempts.some((attempt) =>
    attempt.answerRevealed === true ||
    (Array.isArray(attempt.keys) && attempt.keys.some((key) => key.targetVisible === true || key.visibility === 'full' || key.visibility === 'partial')),
  )
  if (hasAssistance) return { kind: 'assisted', ...times }
  const completeVisibility = trace.attempts.every((attempt) =>
    typeof attempt.answerRevealed === 'boolean' &&
    Array.isArray(attempt.keys) &&
    attempt.keys.every((key) =>
      (key.visibility === 'hidden' || key.visibility === 'partial' || key.visibility === 'full') &&
      typeof key.targetVisible === 'boolean',
    ),
  )
  if (!completeVisibility || first.outcome !== 'correct' || first.keys.length === 0 || typingDurationMs === undefined) {
    return { kind: 'unknown', ...times }
  }
  return { kind: 'independent', ...times }
}

export function rateWordAttempt(record: Pick<IWordRecord, 'word' | 'wrongCount' | 'timing'>): SpacedReviewRating {
  if (record.wrongCount > 0) return 'again'

  const durationMs = record.timing.reduce((total, duration) => total + duration, 0)
  const hardThreshold = Math.max(2600, record.word.length * 480)
  const easyThreshold = Math.max(900, record.word.length * 230)
  if (durationMs > hardThreshold) return 'hard'
  if (durationMs > 0 && durationMs <= easyThreshold) return 'easy'
  return 'good'
}

export function calculateSpacedReviewState(
  previous: ISpacedReviewState | undefined,
  record: ReviewInput,
  identity: WordLearningIdentity,
): ISpacedReviewState {
  return decideSpacedReview(previous, record, identity).state
}

export function decideSpacedReview(
  previous: ISpacedReviewState | undefined,
  record: ReviewInput,
  identity: WordLearningIdentity,
): ISpacedReviewDecision & { state: ISpacedReviewState } {
  const rating = rateWordAttempt(record)
  const classified = classifySpacedReviewEvidence(record)
  const evidence = classified.kind
  const start = exposureStartEvidence(record)
  const dueAtStart = previous
    ? dueAtExposureStart(Math.max(previous.nextReviewAt, previous.retestAt ?? previous.nextReviewAt), start)
    : 'unknown'
  const isDue = dueAtStart === 'due'
  const decisionBase = {
    algorithm: SPACED_REVIEW_ALGORITHM,
    evidence,
    dueAtStart,
    isDue,
    isRetry: evidence === 'retry',
    stageBefore: previous?.stage ?? null,
    dueAtBefore: previous?.nextReviewAt ?? null,
    exposureStartedAt: start.startedAt,
    firstKeyDelayMs: classified.firstKeyDelayMs,
    typingDurationMs: classified.typingDurationMs,
  }
  const sourceFields = {
    sourceDicts: mergeSourceDicts(previous?.sourceDicts ?? [], record.dict),
    preferredSourceDict: record.dict,
    word: record.word,
  }
  const preserve = (previousState: ISpacedReviewState, reason: SpacedReviewReason, retestAt = previousState.retestAt) => {
    const state = {
      ...previousState,
      ...sourceFields,
      totalReviews: previousState.totalReviews + 1,
      retestAt,
      longTermReviewAt: retestAt !== undefined ? previousState.nextReviewAt : previousState.longTermReviewAt,
    }
    return { ...decisionBase, state, stageAfter: state.stage, dueAtAfter: state.nextReviewAt, retestAt, reason }
  }
  // A failed attempt's short deadline survives immediate practice.
  if (previous && rating === 'again' && previous.lastRating === 'again' && record.timeStamp < previous.nextReviewAt) {
    return preserve(previous, 'repeated-failure')
  }
  if (previous && rating !== 'again') {
    if (evidence === 'retry') return preserve(previous, 'retry')
    if (dueAtStart === 'early') return preserve(previous, 'early')
    if (dueAtStart === 'unknown') return preserve(previous, 'unknown')
    if (evidence === 'assisted') return preserve(previous, 'assisted-retest', scheduledReviewAt(record.timeStamp, 10))
    if (evidence === 'unknown') return preserve(previous, 'unknown')
  }
  const previousStage = previous?.stage ?? 0
  const stage = rating === 'again' ? 0 :
    evidence === 'independent'
      ? Math.min(previous ? previousStage + 1 : 1, EBBINGHAUS_INTERVAL_MINUTES.length - 1)
      : 0
  const intervalMinutes = EBBINGHAUS_INTERVAL_MINUTES[stage]
  const state: ISpacedReviewState = {
    scope: identity.scope,
    normalizedWord: identity.normalizedWord,
    ...sourceFields,
    stage,
    intervalMinutes,
    successStreak: rating === 'again' ? 0 : evidence === 'independent' ? (previous?.successStreak ?? 0) + 1 : 0,
    lapses: (previous?.lapses ?? 0) + (rating === 'again' ? 1 : 0),
    totalReviews: (previous?.totalReviews ?? 0) + 1,
    lastReviewedAt: record.timeStamp,
    nextReviewAt: scheduledReviewAt(record.timeStamp, intervalMinutes),
    lastRating: rating,
  }
  const reason: SpacedReviewReason = rating === 'again' ? 'failure' : previous ? 'independent-due' : 'new'
  return { ...decisionBase, state, stageAfter: stage, dueAtAfter: state.nextReviewAt, reason }
}
