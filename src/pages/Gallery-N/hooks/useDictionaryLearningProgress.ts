import type { DictionaryLearningProgress } from '@/utils/dictionaryLearning'
import { dictionaryLearningKeys, loadDictionaryLearningProgress } from '@/utils/dictionaryLearning'
import type { Dictionary, Word } from '@/typings'
import { db, spacedReviewDb } from '@/utils/db'
import { serializedWordLearningKey, spacedReviewIdentity, wordLearningIdentity, wordLearningStateKey } from '@/utils/db/word-learning-identity'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import useSWR from 'swr'

const EMPTY_KEYS = new Set<string>()

export type DictionaryLearningProgressResult =
  | { status: 'idle' | 'loading'; words: Word[]; progress?: undefined; learnedKeys: ReadonlySet<string> }
  | { status: 'ready'; words: Word[]; progress: DictionaryLearningProgress; learnedKeys: ReadonlySet<string>; excludedKeys: ReadonlySet<string> }
  | { status: 'error'; words: Word[]; progress?: undefined; learnedKeys: ReadonlySet<string>; error: Error }

type QuerySnapshot =
  | { queryKey: string; status: 'loading'; learnedKeys: string[] }
  | { queryKey: string; status: 'ready'; progress: DictionaryLearningProgress; learnedKeys: string[]; excludedKeys: string[] }
  | { queryKey: string; status: 'error'; error: Error; learnedKeys: string[] }

const LOADING_QUERY: QuerySnapshot = { queryKey: '', status: 'loading', learnedKeys: [] }

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

export function useDictionaryLearningProgress(dictionary: Dictionary, enabled = true): DictionaryLearningProgressResult {
  const { data, error: wordListError, isLoading: isWordListLoading } = useSWR<Word[], Error>(
    enabled ? dictionary.url : null,
    wordListFetcher,
  )
  const words = data ?? []
  const keys = useMemo(() => (enabled && data ? dictionaryLearningKeys(dictionary.id, data) : []), [data, dictionary.id, enabled])
  const queryKey = useMemo(
    () => (enabled && data ? `${dictionary.id}:${keys.map(([scope, word]) => `${scope}\u0000${word}`).join('\u0001')}` : ''),
    [data, dictionary.id, enabled, keys],
  )

  const query = useLiveQuery<QuerySnapshot, QuerySnapshot>(
    async () => {
      if (!enabled || !data) return { queryKey, status: 'loading', learnedKeys: [] }
      try {
        const feedback = await db.wordFeedback.bulkGet(data.map((word) => wordLearningStateKey(wordLearningIdentity(dictionary.id, word.name))))
        const excludedKeys = new Set(data.flatMap((word, index) => feedback[index]?.blacklisted
          ? [serializedWordLearningKey(spacedReviewIdentity(dictionary.id, word.name))] : []))
        const snapshot = await loadDictionaryLearningProgress(
          dictionary.id,
          data,
          (requestedKeys) => spacedReviewDb.wordStates.bulkGet(requestedKeys),
          Math.floor(Date.now() / 1000),
          excludedKeys,
        )
        return { queryKey, status: 'ready', progress: snapshot.progress, learnedKeys: Array.from(snapshot.learnedKeys), excludedKeys: Array.from(excludedKeys) }
      } catch (error) {
        console.error('Failed to read dictionary learning progress', error)
        return { queryKey, status: 'error', error: asError(error), learnedKeys: [] }
      }
    },
    [enabled, queryKey],
    LOADING_QUERY,
  )

  if (!enabled) return { status: 'idle', words: [], learnedKeys: EMPTY_KEYS }
  if (wordListError) return { status: 'error', words: [], learnedKeys: EMPTY_KEYS, error: asError(wordListError) }
  if (isWordListLoading || !data || query.queryKey !== queryKey || query.status === 'loading') {
    return { status: 'loading', words, learnedKeys: EMPTY_KEYS }
  }
  if (query.status === 'error') return { status: 'error', words, learnedKeys: EMPTY_KEYS, error: query.error }
  return { status: 'ready', words, progress: query.progress, learnedKeys: new Set(query.learnedKeys), excludedKeys: new Set(query.excludedKeys) }
}
