import type { WordWithIndex } from '@/typings'

export type FilteredBatchWords = {
  words: WordWithIndex[]
  fullWords: WordWithIndex[]
  skippedCount: number
  allLearned: boolean
}

export function filterLearnedBatchWords(
  words: WordWithIndex[],
  learnedKeys: Set<string>,
  includeLearnedWords: boolean,
  keyOf: (word: WordWithIndex) => string,
  excludedKeys: ReadonlySet<string> = new Set(),
): FilteredBatchWords {
  const fullWords = words.map((word) => ({ ...word, isLearned: learnedKeys.has(keyOf(word)) }))
  const filteredWords = fullWords.filter((word) => !excludedKeys.has(keyOf(word)) && (includeLearnedWords || !word.isLearned))
  return {
    words: filteredWords,
    fullWords,
    skippedCount: fullWords.length - filteredWords.length,
    allLearned: fullWords.length > 0 && filteredWords.length === 0,
  }
}
