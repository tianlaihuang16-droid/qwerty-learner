import { CHAPTER_LENGTH } from '@/constants'
import type { Word } from '@/typings'
import type { ISpacedReviewState } from '@/utils/db/record'
import { EBBINGHAUS_INTERVAL_MINUTES } from '@/utils/db/spaced-repetition'
import { serializedWordLearningKey, spacedReviewIdentity, wordLearningStateKey } from '@/utils/db/word-learning-identity'

export const MASTERED_STAGE = 7

export type DictionaryLearningStatus = 'unlearned' | 'learning' | 'due' | 'mastered'

export type DictionaryLearningProgress = {
  total: number
  unlearned: number
  learning: number
  due: number
  mastered: number
  stages: number[]
}

type ProgressState = Pick<ISpacedReviewState, 'stage' | 'nextReviewAt'>
type ProgressStoredState = Pick<ISpacedReviewState, 'scope' | 'normalizedWord' | 'stage' | 'nextReviewAt'>

export function dictionaryLearningKeys(dictID: string, words: Word[]): [string, string][] {
  const seen = new Set<string>()
  const keys: [string, string][] = []

  for (const word of words) {
    const identity = spacedReviewIdentity(dictID, word.name)
    const serializedKey = serializedWordLearningKey(identity)
    if (seen.has(serializedKey)) continue
    seen.add(serializedKey)
    keys.push(wordLearningStateKey(identity))
  }

  return keys
}

export async function loadDictionaryLearningProgress(
  dictID: string,
  words: Word[],
  readStates: (keys: [string, string][]) => Promise<(ProgressStoredState | undefined)[]>,
  now: number,
  excludedKeys: ReadonlySet<string> = new Set(),
): Promise<{ progress: DictionaryLearningProgress; learnedKeys: ReadonlySet<string> }> {
  const keys = dictionaryLearningKeys(dictID, words)
  const states = await readStates(keys)
  const stateByKey = new Map<string, ProgressState>()
  const learnedKeys = new Set<string>()

  for (const state of states) {
    if (!state) continue
    const key = serializedWordLearningKey(state)
    learnedKeys.add(key)
    stateByKey.set(key, state)
  }

  return { progress: summarizeDictionaryLearning(dictID, words, stateByKey, now, excludedKeys), learnedKeys }
}

export function classifyDictionaryLearningState(state: ProgressState | undefined, now: number): DictionaryLearningStatus {
  if (!state) return 'unlearned'
  if (state.nextReviewAt <= now) return 'due'
  if (state.stage >= MASTERED_STAGE) return 'mastered'
  return 'learning'
}

export function summarizeDictionaryLearning(
  dictID: string,
  words: Word[],
  stateByKey: ReadonlyMap<string, ProgressState>,
  now: number,
  excludedKeys: ReadonlySet<string> = new Set(),
): DictionaryLearningProgress {
  const progress: DictionaryLearningProgress = {
    total: 0,
    unlearned: 0,
    learning: 0,
    due: 0,
    mastered: 0,
    stages: Array.from({ length: EBBINGHAUS_INTERVAL_MINUTES.length }, () => 0),
  }
  const seen = new Set<string>()

  for (const word of words) {
    const key = serializedWordLearningKey(spacedReviewIdentity(dictID, word.name))
    if (seen.has(key)) continue
    seen.add(key)
    if (excludedKeys.has(key)) continue
    progress.total += 1
    const state = stateByKey.get(key)
    progress[classifyDictionaryLearningState(state, now)] += 1
    if (state) progress.stages[state.stage] += 1
  }

  return progress
}

export function summarizeGlobalLearning(
  entries: ReadonlyArray<{ dictID: string; words: Word[] }>,
  stateByKey: ReadonlyMap<string, ProgressState>,
  effectiveDueAtByKey: ReadonlyMap<string, number>,
  excludedKeys: ReadonlySet<string>,
  now: number,
): DictionaryLearningProgress {
  const progress: DictionaryLearningProgress = {
    total: 0, unlearned: 0, learning: 0, due: 0, mastered: 0,
    stages: Array.from({ length: EBBINGHAUS_INTERVAL_MINUTES.length }, () => 0),
  }
  const seen = new Set<string>()
  for (const { dictID, words } of entries) {
    for (const word of words) {
      const key = serializedWordLearningKey(spacedReviewIdentity(dictID, word.name))
      if (seen.has(key)) continue
      seen.add(key)
      if (excludedKeys.has(key)) continue
      progress.total += 1
      const state = stateByKey.get(key)
      if (!state) {
        progress.unlearned += 1
        continue
      }
      const effectiveDueAt = effectiveDueAtByKey.get(key)
      const status = classifyDictionaryLearningState({ ...state, nextReviewAt: effectiveDueAt ?? state.nextReviewAt }, now)
      progress[status] += 1
      progress.stages[state.stage] += 1
    }
  }
  return progress
}

export function findNextDictionarySlice(
  dictID: string,
  words: Word[],
  learnedKeys: ReadonlySet<string>,
  options: { startSlice: number; includeLearned: boolean; allowWrap: boolean; excludedKeys?: ReadonlySet<string> },
): number | undefined {
  const sliceCount = Math.ceil(words.length / CHAPTER_LENGTH)
  if (sliceCount === 0) return undefined

  const requestedStart = Math.max(0, Math.trunc(options.startSlice))
  if (options.includeLearned) {
    if (requestedStart >= sliceCount) return undefined
    for (let sliceIndex = requestedStart; sliceIndex < sliceCount; sliceIndex += 1) {
      if (
        words
          .slice(sliceIndex * CHAPTER_LENGTH, (sliceIndex + 1) * CHAPTER_LENGTH)
          .some((word) => !options.excludedKeys?.has(serializedWordLearningKey(spacedReviewIdentity(dictID, word.name))))
      )
        return sliceIndex
    }
    return undefined
  }

  const startSlice = requestedStart >= sliceCount ? (options.allowWrap ? 0 : sliceCount) : requestedStart
  const order = Array.from({ length: Math.max(0, sliceCount - startSlice) }, (_, offset) => startSlice + offset)
  if (options.allowWrap) order.push(...Array.from({ length: startSlice }, (_, index) => index))

  return order.find((sliceIndex) =>
    words.slice(sliceIndex * CHAPTER_LENGTH, (sliceIndex + 1) * CHAPTER_LENGTH).some((word) => {
      const key = serializedWordLearningKey(spacedReviewIdentity(dictID, word.name))
      return !learnedKeys.has(key) && !options.excludedKeys?.has(key)
    }),
  )
}
