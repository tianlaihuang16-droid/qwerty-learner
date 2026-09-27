import type { ISpacedReviewState } from './record'
import { normalizeLearningWord } from './word-learning-identity'

export type ReviewAdjustment = {
  dictionaryId: string
  word: string
  priorityDelta?: number
  recommendedAt?: number | string | null
  reason?: string
}

export function orderedReviewSources(state: ISpacedReviewState, requestedDict?: string) {
  const latestFirst = [...state.sourceDicts].reverse()
  const sources = [state.preferredSourceDict, ...latestFirst].filter(
    (dictID, index, all) => Boolean(dictID) && all.indexOf(dictID) === index,
  )
  if (!requestedDict || !sources.includes(requestedDict)) return sources
  return [requestedDict, ...sources.filter((dictID) => dictID !== requestedDict)]
}

function adjustmentPriority(adjustment: ReviewAdjustment) {
  const priority = Number(adjustment.priorityDelta ?? 0)
  return Number.isFinite(priority) ? priority : 0
}

function adjustmentTime(adjustment: ReviewAdjustment) {
  if (typeof adjustment.recommendedAt === 'number' && Number.isFinite(adjustment.recommendedAt)) return adjustment.recommendedAt
  if (typeof adjustment.recommendedAt === 'string') {
    const timestamp = Date.parse(adjustment.recommendedAt)
    if (Number.isFinite(timestamp)) return Math.floor(timestamp / 1000)
  }
  return Number.POSITIVE_INFINITY
}

export function selectAdjustmentForState(state: ISpacedReviewState, adjustments: ReviewAdjustment[]) {
  return adjustments
    .filter(
      (adjustment) =>
        state.sourceDicts.includes(adjustment.dictionaryId) &&
        normalizeLearningWord(adjustment.word, state.scope) === state.normalizedWord,
    )
    .sort(
      (left, right) =>
        adjustmentPriority(right) - adjustmentPriority(left) ||
        adjustmentTime(left) - adjustmentTime(right) ||
        left.dictionaryId.localeCompare(right.dictionaryId),
    )[0]
}
