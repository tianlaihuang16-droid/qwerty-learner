import type { WordLearningIdentity } from './word-learning-identity'
import { mergeSourceDicts, serializedWordLearningKey, wordLearningIdentity } from './word-learning-identity'

export type WordFeedbackAction = { type: 'blacklist'; value: boolean } | { type: 'not-helpful' }

export interface IWordFeedback extends WordLearningIdentity {
  word: string
  sourceDicts: string[]
  blacklisted: boolean
  blacklistedAt?: number
  notHelpfulCount: number
  lastNotHelpfulAt?: number
  updatedAt: number
}

export function updateWordFeedback(
  previous: IWordFeedback | undefined,
  dictID: string,
  word: string,
  action: WordFeedbackAction,
  now: number,
): IWordFeedback {
  const identity = wordLearningIdentity(dictID, word)
  const next: IWordFeedback = {
    scope: identity.scope,
    normalizedWord: identity.normalizedWord,
    word: word.normalize('NFC').trim(),
    sourceDicts: mergeSourceDicts(previous?.sourceDicts ?? [], dictID),
    blacklisted: previous?.blacklisted ?? false,
    blacklistedAt: previous?.blacklistedAt,
    notHelpfulCount: previous?.notHelpfulCount ?? 0,
    lastNotHelpfulAt: previous?.lastNotHelpfulAt,
    updatedAt: now,
  }

  if (action.type === 'blacklist') {
    next.blacklisted = action.value
    if (action.value) next.blacklistedAt = previous?.blacklisted ? previous.blacklistedAt ?? now : now
    else delete next.blacklistedAt
  } else {
    next.notHelpfulCount += 1
    next.lastNotHelpfulAt = now
  }

  return next
}

export function isFeedbackActive(feedback: Pick<IWordFeedback, 'blacklisted' | 'notHelpfulCount'>) {
  return feedback.blacklisted || feedback.notHelpfulCount > 0
}

export function wordFeedbackMap(feedback: readonly IWordFeedback[]) {
  return new Map(feedback.map((row) => [serializedWordLearningKey(row), row] as const))
}

export function withoutBlacklistedWords<T extends { dictionaryId: string; word: string }>(
  candidates: readonly T[],
  feedbackByKey: ReadonlyMap<string, Pick<IWordFeedback, 'blacklisted'>>,
) {
  return candidates.filter((candidate) => {
    const key = serializedWordLearningKey(wordLearningIdentity(candidate.dictionaryId, candidate.word))
    return !feedbackByKey.get(key)?.blacklisted
  })
}
