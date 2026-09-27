import { db, spacedReviewDb } from '.'
import type { ReviewCacheMeta } from '.'
import { isDataRestoring, runStudyWrite } from './maintenance'
import { ReviewRecord } from './record'
import type { ISpacedReviewState, IWordRecord, ReviewWord } from './record'
import { orderedReviewSources, selectAdjustmentForState } from './review-source'
import type { ReviewAdjustment } from './review-source'
import { EBBINGHAUS_INTERVAL_MINUTES, SPACED_REVIEW_ALGORITHM, calculateSpacedReviewState, decideSpacedReview, nextFsrsCard } from './spaced-repetition'
import { calculateSpacedReviewState as calculateLegacyReviewState } from './legacy-spaced-repetition'
import type { IWordFeedback } from './word-feedback'
import {
  isDictionaryScopedReview,
  serializedWordLearningKey,
  spacedReviewIdentity,
  wordLearningIdentity,
  wordLearningStateKey,
} from './word-learning-identity'
import { idDictionaryMap } from '@/resources/dictionary'
import { appendCloudStudyEvent, readGptReviewAdjustments, writeAlgorithmReviewPlan } from '@/utils/cloudSync'
import { wordListFetcher } from '@/utils/wordListFetcher'

const DAY_SECONDS = 24 * 60 * 60
const MAX_REVIEW_WORDS_PER_SESSION = 30
export const ALL_SPACED_REVIEW_DICT_ID = 'spaced-review-today'

type GptAdjustmentDocument = {
  version: number
  expiresAt?: string | null
  items: ReviewAdjustment[]
}

export type EffectiveReviewItem = {
  state: ISpacedReviewState
  effectiveDueAt: number
  priorityDelta: number
  gptReason?: string
}

function queueDueAt(state: ISpacedReviewState) {
  return state.retestAt ?? state.nextReviewAt
}

function wasGptAdjusted(item: EffectiveReviewItem) {
  const unadjustedDueAt = queueDueAt(item.state)
  return Boolean(item.gptReason || item.priorityDelta !== 0 || item.effectiveDueAt !== unadjustedDueAt)
}

function excludeBlacklistedStates(states: ISpacedReviewState[], feedback: IWordFeedback[]) {
  const blacklistedKeys = new Set(feedback.filter((row) => row.blacklisted).map(serializedWordLearningKey))
  return states.filter(
    (state) => !blacklistedKeys.has(serializedWordLearningKey(wordLearningIdentity(state.preferredSourceDict, state.word))),
  )
}

function applyAdjustments(states: ISpacedReviewState[], adjustments: ReviewAdjustment[], now: number) {
  return states
    .map((state): EffectiveReviewItem => {
      const adjustment = selectAdjustmentForState(state, adjustments)
      const requestedTime = parseRecommendedAt(adjustment?.recommendedAt)
      const earliest = state.nextReviewAt - 7 * DAY_SECONDS
      const latest = state.nextReviewAt <= now ? now + DAY_SECONDS : state.nextReviewAt + 2 * DAY_SECONDS
      const adjustedDueAt = requestedTime === undefined ? state.nextReviewAt : Math.min(latest, Math.max(earliest, requestedTime))
      // A pending assisted retest owns the actionable queue deadline. GPT timing
      // adjustments resume after an independent retest clears retestAt.
      const effectiveDueAt = state.retestAt ?? adjustedDueAt
      const requestedPriority = Number(adjustment?.priorityDelta ?? 0)
      const priorityDelta = Number.isFinite(requestedPriority) ? Math.max(-3, Math.min(3, Math.round(requestedPriority))) : 0
      const gptReason = typeof adjustment?.reason === 'string' ? adjustment.reason.trim() || undefined : undefined
      return { state, effectiveDueAt, priorityDelta, gptReason }
    })
    .sort(
      (left, right) =>
        right.priorityDelta - left.priorityDelta || left.effectiveDueAt - right.effectiveDueAt || right.state.lapses - left.state.lapses,
    )
}

function parseRecommendedAt(value: ReviewAdjustment['recommendedAt']) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return Math.floor(timestamp / 1000)
  }
  return undefined
}

async function validatedAdjustments(): Promise<ReviewAdjustment[]> {
  if (localStorage.getItem('gptReviewAdjustmentsEnabled') === 'false') return []
  const raw = await readGptReviewAdjustments()
  if (!raw || typeof raw !== 'object') return []
  const document = raw as Partial<GptAdjustmentDocument>
  if (document.version !== 1 || !Array.isArray(document.items)) return []
  if (document.expiresAt) {
    const expiresAt = Date.parse(document.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return []
  }

  return document.items.filter(
    (item): item is ReviewAdjustment =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof item.dictionaryId === 'string' &&
      typeof item.word === 'string' &&
      item.word.trim().length > 0,
  )
}

export async function getEffectiveReviewItems(dictID: string, now = Math.floor(Date.now() / 1000)) {
  const dictionaryScoped = isDictionaryScopedReview(dictID)
  const [states, adjustments, feedback] = await Promise.all([
    dictionaryScoped
      ? spacedReviewDb.wordStates.where('scope').equals(`dictionary:${dictID}`).toArray()
      : spacedReviewDb.wordStates.where('sourceDicts').equals(dictID).toArray(),
    dictionaryScoped ? Promise.resolve<ReviewAdjustment[]>([]) : validatedAdjustments(),
    db.wordFeedback.toArray(),
  ])
  return applyAdjustments(excludeBlacklistedStates(states, feedback), adjustments, now)
}

function hasAvailableSource(state: ISpacedReviewState) {
  return orderedReviewSources(state).some((dictID) => Boolean(idDictionaryMap[dictID]))
}

async function getAllEffectiveReviewItems(now = Math.floor(Date.now() / 1000)) {
  const [states, adjustments, feedback] = await Promise.all([
    spacedReviewDb.wordStates.toArray(),
    validatedAdjustments(),
    db.wordFeedback.toArray(),
  ])
  return applyAdjustments(excludeBlacklistedStates(states.filter((state) => !isDictionaryScopedReview(state.preferredSourceDict)), feedback), adjustments, now)
}

export async function getSpacedReviewSummary(dictID: string) {
  const now = Math.floor(Date.now() / 1000)
  const items = await getEffectiveReviewItems(dictID, now)
  const dueItems = items.filter((item) => item.effectiveDueAt <= now)
  const nextItem = items.find((item) => item.effectiveDueAt > now)
  return {
    dueCount: dueItems.length,
    gptAdjustedCount: items.filter(wasGptAdjusted).length,
    nextReviewAt: nextItem?.effectiveDueAt,
  }
}

export async function getAllSpacedReviewSummary() {
  const now = Math.floor(Date.now() / 1000)
  const items = await getAllEffectiveReviewItems(now)
  const dueItems = items.filter((item) => item.effectiveDueAt <= now && hasAvailableSource(item.state))
  const nextItem = items.find((item) => item.effectiveDueAt > now && hasAvailableSource(item.state))
  return {
    dueCount: dueItems.length,
    gptAdjustedCount: items.filter(wasGptAdjusted).length,
    nextReviewAt: nextItem?.effectiveDueAt,
  }
}

// Words that are not due yet but will be within this window can be practiced early.
export const IMMEDIATE_DUE_WINDOW_SECONDS = 10 * 60

async function soonDueItems(windowSeconds: number) {
  const now = Math.floor(Date.now() / 1000)
  const items = await getAllEffectiveReviewItems(now)
  return {
    now,
    items: items.filter((item) => item.effectiveDueAt > now && item.effectiveDueAt <= now + windowSeconds && hasAvailableSource(item.state)),
  }
}

export async function getSoonDueReviewSummary(windowSeconds = IMMEDIATE_DUE_WINDOW_SECONDS) {
  const { items } = await soonDueItems(windowSeconds)
  return {
    count: items.length,
    nextReviewAt: items.reduce<number | undefined>(
      (soonest, item) => (soonest === undefined || item.effectiveDueAt < soonest ? item.effectiveDueAt : soonest),
      undefined,
    ),
  }
}

// Early practice gets its own queue; the saved long-term deadline stays unchanged.
export async function generateSoonDueSpacedReviewRecord(
  windowSeconds = IMMEDIATE_DUE_WINDOW_SECONDS,
): Promise<ReviewRecord | undefined> {
  const { items } = await soonDueItems(windowSeconds)
  const words = await resolveReviewWords(items.slice(0, MAX_REVIEW_WORDS_PER_SESSION))
  if (words.length === 0) return undefined

  const record = new ReviewRecord(ALL_SPACED_REVIEW_DICT_ID, words, 'spaced')
  record.id = await runStudyWrite(() => db.reviewRecords.add(record))
  return record
}

export async function generateSpacedReviewRecord(dictID: string): Promise<ReviewRecord | undefined> {
  if (!idDictionaryMap[dictID]) return undefined
  const now = Math.floor(Date.now() / 1000)
  const dueItems = (await getEffectiveReviewItems(dictID, now))
    .filter((item) => item.effectiveDueAt <= now)
    .slice(0, MAX_REVIEW_WORDS_PER_SESSION)
  const dueWords = await resolveReviewWords(dueItems, dictID)
  if (dueWords.length === 0) return undefined

  const record = new ReviewRecord(dictID, dueWords, 'spaced')
  record.id = await runStudyWrite(() => db.reviewRecords.add(record))
  return record
}

export async function generateAllSpacedReviewRecord(): Promise<ReviewRecord | undefined> {
  const now = Math.floor(Date.now() / 1000)
  const dueItems = (await getAllEffectiveReviewItems(now))
    .filter((item) => item.effectiveDueAt <= now && hasAvailableSource(item.state))
    .slice(0, MAX_REVIEW_WORDS_PER_SESSION)
  if (dueItems.length === 0) return undefined

  const words = await resolveReviewWords(dueItems)
  if (words.length === 0) return undefined

  const record = new ReviewRecord(ALL_SPACED_REVIEW_DICT_ID, words, 'spaced')
  record.id = await runStudyWrite(() => db.reviewRecords.add(record))
  return record
}

async function resolveReviewWords(items: EffectiveReviewItem[], requestedDict?: string): Promise<ReviewWord[]> {
  const candidates = items.map((item) => orderedReviewSources(item.state, requestedDict).filter((dictID) => idDictionaryMap[dictID]))
  const dictionaryIds = Array.from(new Set(candidates.flat()))
  const dictionaryWordMaps = await Promise.all(
    dictionaryIds.map(async (dictID) => {
      try {
        const words = await wordListFetcher(idDictionaryMap[dictID].url)
        return [dictID, new Map(words.map((word) => [spacedReviewIdentity(dictID, word.name).normalizedWord, word]))] as const
      } catch (error) {
        console.error(`Failed to load review source dictionary ${dictID}`, error)
        return [dictID, undefined] as const
      }
    }),
  )
  const wordMaps = new Map(dictionaryWordMaps)

  return items
    .map((item, index): ReviewWord | undefined => {
      const sourceDict = candidates[index].find((dictID) => wordMaps.get(dictID)?.has(item.state.normalizedWord))
      const word = sourceDict ? wordMaps.get(sourceDict)?.get(item.state.normalizedWord) : undefined
      if (!sourceDict || !word) {
        console.error(`No available source contains review word ${item.state.scope}:${item.state.normalizedWord}`)
        return undefined
      }
      return { ...word, sourceDict }
    })
    .filter((word): word is ReviewWord => word !== undefined)
}

export async function rebuildSpacedReviewScheduleFromHistory(syncCloud = true) {
  const records = (await db.wordRecords.orderBy('timeStamp').toArray()) as IWordRecord[]
  const states = new Map<string, ISpacedReviewState>()
  for (const record of records) {
    const identity = spacedReviewIdentity(record.dict, record.word)
    const key = serializedWordLearningKey(identity)
    const previous = states.get(key)
    if (record.spacedReviewPending) {
      const pendingKey = record.gptTraining?.sessionId && record.spelling?.exposureId
        ? `${record.gptTraining.sessionId}:${record.spelling.exposureId}` : undefined
      if (!pendingKey) continue
      const { state, ...decision } = decideSpacedReview(previous, record, identity)
      states.set(key, {
        ...state,
        pendingWordDecisions: { ...previous?.pendingWordDecisions, [pendingKey]: decision },
      })
      continue
    }
    const next = record.spacedReviewDecision?.algorithm === SPACED_REVIEW_ALGORITHM
      ? calculateSpacedReviewState(previous, record, identity)
      : calculateLegacyReviewState(previous, record, identity)
    next.lastRecordId = (record as IWordRecord & { id?: number }).id
    if (previous?.pendingWordDecisions) next.pendingWordDecisions = previous.pendingWordDecisions
    states.set(key, next)
  }
  await spacedReviewDb.transaction('rw', spacedReviewDb.wordStates, spacedReviewDb.meta, async () => {
    await spacedReviewDb.wordStates.clear()
    if (states.size > 0) await spacedReviewDb.wordStates.bulkPut(Array.from(states.values()))
    await spacedReviewDb.meta.put({
      key: 'schedule',
      algorithm: SPACED_REVIEW_ALGORITHM,
      recordCount: records.length,
      lastRecordId: records.reduce((last, record) => Math.max(last, (record as IWordRecord & { id: number }).id), 0),
    })
  })
  if (syncCloud) {
    try {
      await syncAlgorithmReviewPlan()
    } catch (error) {
      console.error('Local review plan is ready; cloud copy could not be updated', error)
    }
  }
}

export async function updateLastSpacedReviewRating(recordId: number, rating: 'hard' | 'easy') {
  return runStudyWrite(async () => {
    const record = await db.wordRecords.get(recordId)
    if (!record || !record.spacedReviewDecision || record.spacedReviewDecision.algorithm !== SPACED_REVIEW_ALGORITHM)
      return false
    const decision = record.spacedReviewDecision
    if (!['new', 'independent-due'].includes(decision.reason) || decision.rating === 'again' || !decision.fsrsCardBefore)
      return false
    const identity = spacedReviewIdentity(record.dict, record.word)
    const key = wordLearningStateKey(identity)
    const current = await spacedReviewDb.wordStates.get(key)
    if (!current?.fsrsCard || current.lastRecordId !== recordId) return false
    const atMs = record.spelling?.completedAtMs ?? record.timeStamp * 1000
    const card = nextFsrsCard(decision.fsrsCardBefore, atMs, rating)
    const intervalMinutes = Math.max(0, (card.dueMs - atMs) / 60000)
    const stage = EBBINGHAUS_INTERVAL_MINUTES.reduce((band, minimum, index) => intervalMinutes >= minimum ? index : band, 0)
    const revisedDecision = { ...decision, rating, ratingSource: 'manual' as const,
      stageAfter: stage, dueAtAfter: card.dueMs / 1000 }
    const revisedState = { ...current, fsrsCard: card, stage, intervalMinutes,
      nextReviewAt: card.dueMs / 1000, lastRating: rating }
    await db.wordRecords.update(recordId, { spacedReviewDecision: revisedDecision })
    try {
      await spacedReviewDb.wordStates.put(revisedState)
    } catch (error) {
      await db.wordRecords.update(recordId, { spacedReviewDecision: decision })
      throw error
    }
    try {
      await appendCloudStudyEvent('rating-correction', { recordId, word: record.word, dict: record.dict,
        previousRating: decision.rating, rating, spacedReviewDecision: revisedDecision })
    } catch (error) {
      // The local record and schedule have already committed. A cloud queue
      // failure must not tell the learner that their manual rating was lost.
      console.error('Could not queue rating correction event', error)
    }
    scheduleAlgorithmReviewPlan()
    return true
  })
}

async function restoreReferenceDictionaryToGlobalReview(meta: ReviewCacheMeta) {
  const referenceDictID = 'ielts-predicted-spelling-risk-2026-09-14'
  await spacedReviewDb.transaction('rw', spacedReviewDb.wordStates, spacedReviewDb.meta, async () => {
    const privateStates = await spacedReviewDb.wordStates.where('scope').equals(`dictionary:${referenceDictID}`).toArray()
    for (const privateState of privateStates) {
      const globalState = await spacedReviewDb.wordStates.get(['en', privateState.normalizedWord])
      const identity = { scope: 'en', normalizedWord: privateState.normalizedWord }
      const latestState = globalState && globalState.lastReviewedAt > privateState.lastReviewedAt ? globalState : privateState
      await spacedReviewDb.wordStates.put({
        ...latestState,
        ...identity,
        sourceDicts: Array.from(new Set([...(globalState?.sourceDicts ?? []), ...privateState.sourceDicts])),
        totalReviews: Math.max(globalState?.totalReviews ?? 0, privateState.totalReviews),
        lapses: Math.max(globalState?.lapses ?? 0, privateState.lapses),
      })
      await spacedReviewDb.wordStates.delete(wordLearningStateKey(privateState))
    }
    await spacedReviewDb.meta.put(meta)
  })
}

export async function initializeSpacedReviewSchedule() {
  const [meta, count, last, cachedCount] = await Promise.all([
    spacedReviewDb.meta.get('schedule'),
    db.wordRecords.count(),
    db.wordRecords.orderBy(':id').last(),
    spacedReviewDb.wordStates.count(),
  ])
  const lastId = (last as (IWordRecord & { id: number }) | undefined)?.id ?? 0
  if (cachedCount === 0 && count > 0) {
    await rebuildSpacedReviewScheduleFromHistory(false)
  } else {
    const updatedMeta = { key: 'schedule', algorithm: SPACED_REVIEW_ALGORITHM, recordCount: count, lastRecordId: lastId }
    const referenceCount = await spacedReviewDb.wordStates
      .where('scope').equals('dictionary:ielts-predicted-spelling-risk-2026-09-14').count()
    if (referenceCount > 0) {
      await restoreReferenceDictionaryToGlobalReview(updatedMeta)
    } else if (!meta || meta.algorithm !== updatedMeta.algorithm || meta.recordCount !== count || meta.lastRecordId !== lastId) {
      await spacedReviewDb.meta.put(updatedMeta)
    }
  }
  scheduleAlgorithmReviewPlan()
}

let planTimer: ReturnType<typeof setTimeout> | undefined
let planSync: Promise<void> | undefined

export function scheduleAlgorithmReviewPlan() {
  if (planTimer || isDataRestoring()) return
  // Fixed window, not a resetting debounce: continuous practice still gets updates.
  planTimer = setTimeout(() => {
    planTimer = undefined
    if (!isDataRestoring()) void syncAlgorithmReviewPlan().catch((error) => console.error('Failed to queue review plan', error))
  }, 15000)
}

export async function flushAlgorithmReviewPlan() {
  if (!planTimer || isDataRestoring()) return
  clearTimeout(planTimer)
  planTimer = undefined
  await syncAlgorithmReviewPlan()
}

export async function syncAlgorithmReviewPlan() {
  // Serialize snapshots so an older, slower export cannot overwrite a newer one.
  const pending = (planSync ?? Promise.resolve()).catch(() => undefined).then(writeCurrentAlgorithmReviewPlan)
  planSync = pending
  try {
    await pending
  } finally {
    if (planSync === pending) planSync = undefined
  }
}

async function writeCurrentAlgorithmReviewPlan() {
  const [states, feedback] = await Promise.all([spacedReviewDb.wordStates.toArray(), db.wordFeedback.toArray()])
  const globalStates = states.filter((state) => !isDictionaryScopedReview(state.preferredSourceDict))
  const now = Math.floor(Date.now() / 1000)
  const orderedFeedback = feedback.sort(
    (left, right) => left.scope.localeCompare(right.scope) || left.normalizedWord.localeCompare(right.normalizedWord),
  )
  const blacklistedKeys = new Set(orderedFeedback.filter((row) => row.blacklisted).map(serializedWordLearningKey))
  await writeAlgorithmReviewPlan({
    version: 1,
    algorithm: SPACED_REVIEW_ALGORITHM,
    generatedAt: new Date().toISOString(),
    gptAdjustmentFile: 'gpt-adjustments.json',
    constraints: {
      priorityDelta: [-3, 3],
      maximumAdvanceDays: 7,
      maximumDelayDays: 2,
      maximumDelayForOverdueHours: 24,
    },
    summary: {
      trackedWords: globalStates.length,
      dueWords: globalStates.filter(
        (state) =>
          queueDueAt(state) <= now &&
          !blacklistedKeys.has(serializedWordLearningKey(wordLearningIdentity(state.preferredSourceDict, state.word))),
      ).length,
    },
    recommendationFeedback: {
      schemaVersion: 1,
      blacklisted: orderedFeedback
        .filter((item) => item.blacklisted)
        .map((item) => ({
          scope: item.scope,
          normalizedWord: item.normalizedWord,
          word: item.word,
          sourceDictionaryIds: item.sourceDicts,
          blacklistedAt: item.blacklistedAt,
          updatedAt: item.updatedAt,
        })),
      notHelpful: orderedFeedback
        .filter((item) => item.notHelpfulCount > 0)
        .map((item) => ({
          scope: item.scope,
          normalizedWord: item.normalizedWord,
          word: item.word,
          sourceDictionaryIds: item.sourceDicts,
          count: item.notHelpfulCount,
          lastMarkedAt: item.lastNotHelpfulAt,
          updatedAt: item.updatedAt,
        })),
    },
    items: globalStates
      .sort((left, right) => queueDueAt(left) - queueDueAt(right))
      .map((state) => ({
        dictionaryId: state.preferredSourceDict,
        sourceDictionaryIds: state.sourceDicts,
        word: state.word,
        scope: state.scope,
        normalizedWord: state.normalizedWord,
        stage: state.stage,
        intervalMinutes: state.intervalMinutes,
        nextReviewAt: state.nextReviewAt,
        nextReviewAtIso: new Date(state.nextReviewAt * 1000).toISOString(),
        queueDueAt: queueDueAt(state),
        queueDueAtIso: new Date(queueDueAt(state) * 1000).toISOString(),
        ...(state.retestAt === undefined ? {} : {
          retestAt: state.retestAt,
          retestAtIso: new Date(state.retestAt * 1000).toISOString(),
        }),
        lastReviewedAt: state.lastReviewedAt,
        lastRating: state.lastRating,
        successStreak: state.successStreak,
        lapses: state.lapses,
        totalReviews: state.totalReviews,
      })),
  })
}
