import { dictionaries } from '@/resources/dictionary'
import type { Word } from '@/typings'
import { db } from '@/utils/db'
import { IMMEDIATE_DUE_WINDOW_SECONDS, getAllReviewSnapshot, summarizeAllSpacedReviewItems } from '@/utils/db/spaced-review-service'
import { serializedWordLearningKey, spacedReviewIdentity } from '@/utils/db/word-learning-identity'
import { summarizeGlobalLearning } from '@/utils/dictionaryLearning'
import { estimateReviewWords, forecastTomorrowReviews, reviewRoundTimingSamples } from '@/utils/reviewForecast'
import { dictionaryWordCache as wordCache } from '@/utils/wordListFetcher'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'

type Entries = { dictID: string; words: Word[] }[]

async function loadSnapshot() {
  const now = new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const [{ states, feedback, items }, sessions] = await Promise.all([
    getAllReviewSnapshot(nowSeconds),
    db.chapterRecords.where('chapter').equals(-1).reverse().limit(100).toArray(),
  ])
  const stateByKey = new Map(states.map((state) => [serializedWordLearningKey(state), state]))
  const excludedKeys = new Set(feedback.filter((row) => row.blacklisted).map(serializedWordLearningKey))
  const effectiveDueAtByKey = new Map(items.map((item) => [serializedWordLearningKey(item.state), item.effectiveDueAt]))
  const relevantSessions = sessions.filter((session) => session.dict === 'spaced-review-today').slice(0, 30)
  const reviewRecordIds = Array.from(new Set(relevantSessions.flatMap((session) => session.wordRecordIds ?? [])))
  const reviewWords = await db.wordRecords.bulkGet(reviewRecordIds)
  const timingSamples = reviewRoundTimingSamples(reviewWords.flatMap(record => record
    ? [{ key: serializedWordLearningKey(spacedReviewIdentity(record.dict, record.word)), atSeconds: record.timeStamp, trace: record.spelling }]
    : []))
  let nextRefreshAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  for (const item of items) {
    for (const at of [item.effectiveDueAt, item.effectiveDueAt - IMMEDIATE_DUE_WINDOW_SECONDS, item.state.nextReviewAt]) {
      if (at * 1000 > now.getTime()) nextRefreshAt = Math.min(nextRefreshAt, at * 1000)
    }
  }
  return {
    stateByKey, effectiveDueAtByKey, excludedKeys, items, timingSamples, now,
    ...summarizeAllSpacedReviewItems(items, nowSeconds),
    nextRefreshAt,
  }
}

export type GalleryLearningResult = ReturnType<typeof useGalleryLearningSnapshot>

export function useGalleryLearningSnapshot() {
  const [revision, setRevision] = useState(0)
  const [entries, setEntries] = useState<Entries>()
  const [wordsError, setWordsError] = useState(false)

  useEffect(() => {
    wordCache.invalidateCloud()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        wordCache.invalidateCloud()
        setRevision((value) => value + 1)
      }, 50)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(refreshTimer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  useEffect(() => {
    let active = true
    const ordinary = dictionaries.filter((dictionary) => dictionary.reviewScope !== 'dictionary')
    Promise.all(ordinary.map(async (dictionary) => ({ dictID: dictionary.id, words: await wordCache.read(dictionary.url) })))
      .then((result) => {
        if (!active) return
        setWordsError(false)
        setEntries(result)
      }).catch((error) => {
        console.error('Failed to load gallery dictionaries', error)
        if (active) setWordsError(true)
      })
    return () => { active = false }
  }, [revision])

  const query = useLiveQuery(async () => {
    try {
      return { snapshot: await loadSnapshot(), error: false }
    } catch (error) {
      console.error('Failed to load gallery learning snapshot', error)
      return { snapshot: undefined, error: true }
    }
  }, [revision])

  const snapshot = query?.snapshot
  useEffect(() => {
    if (!snapshot) return
    // Re-arm even when the deadline is unchanged: the system clock may have
    // moved while the window was inactive.
    const timer = setTimeout(() => setRevision((value) => value + 1), Math.max(0, snapshot.nextRefreshAt - Date.now()))
    return () => clearTimeout(timer)
  }, [snapshot])

  const globalSnapshot = useMemo(() => {
    if (!entries || !snapshot || wordsError) return undefined
    const identities = new Set(entries.flatMap(({ dictID, words }) =>
      words.map((word) => serializedWordLearningKey(spacedReviewIdentity(dictID, word.name)))))
    const dueWords = snapshot.items.filter((item) => identities.has(serializedWordLearningKey(item.state)))
      .map((item) => ({ key: serializedWordLearningKey(item.state), dueAtSeconds: item.effectiveDueAt }))
    return {
      progress: summarizeGlobalLearning(entries, snapshot.stateByKey, snapshot.effectiveDueAtByKey,
        snapshot.excludedKeys, Math.floor(snapshot.now.getTime() / 1000)),
      currentReviewEstimate: estimateReviewWords(dueWords.filter(word => word.dueAtSeconds <= Math.floor(snapshot.now.getTime() / 1000)), snapshot.timingSamples),
      forecast: forecastTomorrowReviews(dueWords, snapshot.timingSamples, snapshot.now),
    }
  }, [entries, snapshot, wordsError])

  return { snapshot: globalSnapshot, review: snapshot, reviewError: Boolean(query?.error), error: wordsError || Boolean(query?.error) }
}
