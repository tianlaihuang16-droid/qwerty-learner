import type {
  FsrsCardSnapshot, ISpacedReviewDecision, ISpacedReviewState, IWordRecord, SpacedReviewDueAtStart,
  SpacedReviewEvidence, SpacedReviewRating, SpacedReviewReason,
} from './record'
import type { WordLearningIdentity } from './word-learning-identity'
import { mergeSourceDicts } from './word-learning-identity'
import { DEFAULT_FSRS_VERSION, DEFAULT_FSRS_WEIGHTS, getFsrsParameters, weightsForDecision } from './fsrs-parameters'
import { Rating, State, createEmptyCard, fsrs } from 'ts-fsrs'
import type { Card, Grade } from 'ts-fsrs'

// Historical progress bands kept for the existing dictionary progress display.
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
// These are display bands for historical progress, not scheduling intervals.
export const SPACED_REVIEW_ALGORITHM = 'fsrs-6-ts-fsrs-5.4.2'
export const FSRS_PARAMETERS_VERSION = DEFAULT_FSRS_VERSION
export const FSRS_WEIGHTS = DEFAULT_FSRS_WEIGHTS
export const FSRS_DESIRED_RETENTION = 0.9
const schedulerFor = (weights: number[]) => fsrs({ request_retention: FSRS_DESIRED_RETENTION, w: weights,
  enable_fuzz: false, enable_short_term: true, learning_steps: ['10m'], relearning_steps: ['10m'] })

function snapshot(card: Card): FsrsCardSnapshot {
  return { dueMs: card.due.getTime(), lastReviewMs: card.last_review?.getTime(),
    stability: card.stability, difficulty: card.difficulty, elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days, learningSteps: card.learning_steps,
    reps: card.reps, lapses: card.lapses, state: card.state }
}

function restoreCard(saved: FsrsCardSnapshot): Card {
  return { due: new Date(saved.dueMs), last_review: saved.lastReviewMs === undefined ? undefined : new Date(saved.lastReviewMs),
    stability: saved.stability, difficulty: saved.difficulty, elapsed_days: saved.elapsedDays,
    scheduled_days: saved.scheduledDays, learning_steps: saved.learningSteps,
    reps: saved.reps, lapses: saved.lapses, state: saved.state as State }
}

export function getFsrsMemoryMetrics(state: Pick<ISpacedReviewState, 'fsrsCard'>, nowMs = Date.now(), weights = getFsrsParameters().weights) {
  const saved = state.fsrsCard
  if (!saved) return null
  return {
    retrievability: saved.lastReviewMs === undefined ? null : schedulerFor(weights).get_retrievability(restoreCard(saved), new Date(nowMs), false),
    difficulty: saved.difficulty,
    stability: saved.stability,
  }
}

function cardBefore(previous: ISpacedReviewState | undefined, nowMs: number): Card {
  if (previous?.fsrsCard) return restoreCard(previous.fsrsCard)
  if (!previous) return createEmptyCard(new Date(nowMs))
  // Keep the existing deadline until this word is actually reviewed. Its old
  // interval is only a conservative seed; historical facts are never rewritten.
  const intervalDays = Math.max(0.01, previous.intervalMinutes / (24 * 60))
  return { due: new Date(previous.nextReviewAt * 1000), last_review: new Date(previous.lastReviewedAt * 1000),
    stability: intervalDays, difficulty: 5, elapsed_days: intervalDays,
    scheduled_days: intervalDays, learning_steps: 0, reps: Math.max(1, previous.totalReviews),
    lapses: previous.lapses, state: State.Review }
}

export function nextFsrsCard(before: FsrsCardSnapshot | null, atMs: number, rating: SpacedReviewRating, weights = getFsrsParameters().weights) {
  const card = before ? restoreCard(before) : createEmptyCard(new Date(atMs))
  const grade = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }[rating]
  return snapshot(schedulerFor(weights).next(card, new Date(atMs), grade as Grade).card)
}

function scheduledReviewAt(timeStamp: number, intervalMinutes: number) {
  return timeStamp + intervalMinutes * 60
}

type ReviewInput = Pick<IWordRecord, 'word' | 'dict' | 'timeStamp' | 'wrongCount' | 'timing'> &
  Pick<Partial<IWordRecord>, 'spelling' | 'spacedReviewDecision'>

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
  const first = trace.attempts.find((attempt) => attempt.outcome === 'correct') ?? trace.attempts[0]
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
  const allErrorsAreSlips = trace.attempts.every((attempt) => attempt.outcome !== 'error' || attempt.error?.isSlip === true)
  if (!completeVisibility || !allErrorsAreSlips || first.outcome !== 'correct' || first.keys.length === 0 || typingDurationMs === undefined) {
    return { kind: 'unknown', ...times }
  }
  return { kind: 'independent', ...times }
}

export function rateSpellingAttempt(record: ReviewInput): SpacedReviewRating {
  const attempts = record.spelling?.attempts
  if (!attempts?.length) return record.wrongCount > 0 ? 'again' : 'good'
  const errors = attempts.filter((attempt) => attempt.outcome === 'error')
  if (errors.some((attempt) => !attempt.error?.isSlip)) return 'again'
  const correct = attempts.find((attempt) => attempt.outcome === 'correct')
  if (!correct) return 'again'
  // A slip is retained as evidence and never promoted automatically to Easy.
  if (errors.length > 0) return 'good'
  const first = correct.firstKeyDelayMs
  const gaps = correct.keys.slice(1).map((key, index) => key.activeAtMs - correct.keys[index].activeAtMs)
  const largestGap = Math.max(0, ...gaps)
  if (correct.timingBasis !== 'after-pronunciation' || first === null || first === undefined) return 'good'
  if (first >= 2200 || largestGap >= 1400) return 'hard'
  if (first <= 600 && largestGap <= 450 && correct.keys.length > 1) return 'easy'
  return 'good'
}

export const rateWordAttempt = rateSpellingAttempt

export function canManuallyRateSpelling(record: ReviewInput): boolean {
  const trace = record.spelling
  return record.wrongCount === 0 && trace?.outcome === 'completed' &&
    trace.attempts.some((attempt) => attempt.outcome === 'correct') &&
    !trace.attempts.some((attempt) => attempt.outcome === 'error')
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
  const parameters = weightsForDecision(record.spacedReviewDecision)
  const storedRating = record.spacedReviewDecision?.algorithm === SPACED_REVIEW_ALGORITHM &&
    record.spacedReviewDecision.ratingSource === 'manual' ? record.spacedReviewDecision.rating : undefined
  const classified = classifySpacedReviewEvidence(record)
  const evidence = classified.kind
  const observedRating = storedRating ?? rateSpellingAttempt(record)
  // A new word with visible or incomplete evidence still needs an unprompted
  // spelling check. Keep the raw attempt; schedule a short FSRS relearning step.
  const rating = !previous && evidence !== 'independent' && observedRating !== 'again'
    ? 'again' : observedRating
  const start = exposureStartEvidence(record)
  const dueAtStart = previous
    ? dueAtExposureStart(Math.max(previous.nextReviewAt, previous.retestAt ?? previous.nextReviewAt), start)
    : 'unknown'
  const isDue = dueAtStart === 'due'
  const decisionBase = {
    algorithm: SPACED_REVIEW_ALGORITHM,
    rating,
    ratingSource: storedRating ? 'manual' as const : 'automatic' as const,
    schedulerParamsVersion: parameters.version,
    schedulerWeights: [...parameters.weights],
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
  if (previous && evidence === 'retry') return preserve(previous, 'retry')
  // A failed attempt's short deadline survives immediate practice.
  if (previous && rating === 'again' && previous.lastRating === 'again' && record.timeStamp < previous.nextReviewAt) {
    return preserve(previous, 'repeated-failure')
  }
  if (previous && rating !== 'again') {
    if (dueAtStart === 'early') return preserve(previous, 'early')
    if (dueAtStart === 'unknown') return preserve(previous, 'unknown')
    if (evidence === 'assisted') return preserve(previous, 'assisted-retest', scheduledReviewAt(record.timeStamp, 10))
    if (evidence === 'unknown') return preserve(previous, 'unknown')
  }
  const atMs = record.spelling?.completedAtMs ?? record.timeStamp * 1000
  const before = snapshot(cardBefore(previous, atMs))
  const next = nextFsrsCard(before, atMs, rating, parameters.weights)
  const intervalMinutes = Math.max(0, (next.dueMs - atMs) / 60000)
  const stage = EBBINGHAUS_INTERVAL_MINUTES.reduce((band, minimum, index) =>
    intervalMinutes >= minimum ? index : band, 0)
  const state: ISpacedReviewState = {
    scope: identity.scope,
    normalizedWord: identity.normalizedWord,
    ...sourceFields,
    stage,
    intervalMinutes,
    fsrsCard: next,
    successStreak: rating === 'again' ? 0 : evidence === 'independent' ? (previous?.successStreak ?? 0) + 1 : 0,
    lapses: (previous?.lapses ?? 0) + (rating === 'again' ? 1 : 0),
    totalReviews: (previous?.totalReviews ?? 0) + 1,
    lastReviewedAt: record.timeStamp,
    nextReviewAt: next.dueMs / 1000,
    lastRating: rating,
  }
  const reason: SpacedReviewReason = rating === 'again' ? 'failure' : previous ? 'independent-due' : 'new'
  return { ...decisionBase, fsrsCardBefore: before, state, stageAfter: stage,
    dueAtAfter: state.nextReviewAt, reason }
}
