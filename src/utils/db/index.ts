import { isDataRestoring, runStudyWrite } from './maintenance'
import type { IChapterRecord, IReviewRecord, IRevisionDictRecord, ISpacedReviewState, IWordRecord, LetterMistakes } from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import { SPACED_REVIEW_ALGORITHM, decideSpacedReview } from './spaced-repetition'
import { spacedReviewIdentity, wordLearningStateKey } from './word-learning-identity'
import type { TrainingOutbox, TrainingRun } from './training-service'
import type { IWordFeedback } from './word-feedback'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom, reviewModeInfoAtom } from '@/store'
import { appendCloudStudyEvent } from '@/utils/cloudSync'
import { trainingWordContext } from '@/utils/gptTraining'
import { spellingEvidence } from '@/utils/spellingPractice'
import type { SpellingTrace } from '@/utils/spellingPractice'
import type { Table } from 'dexie'
import Dexie from 'dexie'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

class RecordDB extends Dexie {
  trainingRuns!: Table<TrainingRun, string>
  trainingOutbox!: Table<TrainingOutbox, string>
  wordRecords!: Table<IWordRecord, number>
  chapterRecords!: Table<IChapterRecord, number>
  reviewRecords!: Table<IReviewRecord, number>
  wordFeedback!: Table<IWordFeedback, [string, string]>

  revisionDictRecords!: Table<IRevisionDictRecord, number>
  revisionWordRecords!: Table<IWordRecord, number>

  constructor() {
    super('RecordDB')
    this.version(1).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,errorCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(2).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(3).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
    })
    this.version(4).stores({ trainingRuns: 'sessionId,taskId,updatedAt', trainingOutbox: 'eventId' })
    this.version(5).stores({ wordFeedback: '[scope+normalizedWord],scope,normalizedWord,updatedAt,*sourceDicts' })
  }
}

export type ReviewCacheMeta = { key: string; algorithm: string; recordCount: number; lastRecordId: number }

class SpacedReviewDB extends Dexie {
  wordStates!: Table<ISpacedReviewState, [string, string]>
  meta!: Table<ReviewCacheMeta, string>

  constructor() {
    super('SpacedReviewDB')
    this.version(1).stores({
      states: '[dict+word],dict,word,nextReviewAt,lastReviewedAt',
    })
    this.version(2).stores({
      states: '[dict+word],dict,word,nextReviewAt,lastReviewedAt',
      meta: 'key',
    })
    this.version(3).stores({
      states: null,
      wordStates: '[scope+normalizedWord],scope,normalizedWord,*sourceDicts,preferredSourceDict,nextReviewAt,lastReviewedAt',
      meta: 'key',
    })
  }
}

export const db = new RecordDB()
export const spacedReviewDb = new SpacedReviewDB()

db.wordRecords.mapToClass(WordRecord)
db.chapterRecords.mapToClass(ChapterRecord)
db.reviewRecords.mapToClass(ReviewRecord)

export function useSaveChapterRecord() {
  const currentChapter = useAtomValue(currentChapterAtom)
  const isRevision = useAtomValue(isReviewModeAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const saveChapterRecord = useCallback(
    async (typingState: TypingState) => {
      const {
        chapterData: { correctCount, wrongCount, userInputLogs, wordCount, words, wordRecordIds },
        timerData: { time },
      } = typingState
      const correctWordIndexes = userInputLogs.filter((log) => log.correctCount > 0 && log.wrongCount === 0).map((log) => log.index)

      const chapterRecord = new ChapterRecord(
        isRevision ? reviewModeInfo.reviewRecord?.dict ?? dictID : dictID,
        isRevision ? -1 : currentChapter,
        time,
        correctCount,
        wrongCount,
        wordCount,
        correctWordIndexes,
        words.length,
        wordRecordIds ?? [],
      )
      chapterRecord.spellingSession = structuredClone(typingState.spellingSession)
      try {
        await runStudyWrite(async () => {
          const recordId = await db.chapterRecords.add(chapterRecord)
          await appendCloudStudyEvent('chapter', {
            recordId,
            ...chapterRecord,
            wpm: chapterRecord.wpm,
            inputAccuracy: chapterRecord.inputAccuracy,
            wordAccuracy: chapterRecord.wordAccuracy,
          })
          await import('./spaced-review-service').then(({ flushAlgorithmReviewPlan }) => flushAlgorithmReviewPlan())
        })
      } catch (error) {
        console.error('Failed to save chapter record', error)
      }
    },
    [currentChapter, dictID, isRevision, reviewModeInfo.reviewRecord?.dict],
  )

  return saveChapterRecord
}

export type WordKeyLogger = {
  letterTimeArray: number[]
  letterMistake: LetterMistakes
}

async function clearPendingWordDecision(record: IWordRecord, key: string) {
  await spacedReviewDb.transaction('rw', spacedReviewDb.wordStates, async () => {
    const identity = spacedReviewIdentity(record.dict, record.word)
    const state = await spacedReviewDb.wordStates.get(wordLearningStateKey(identity))
    if (!state?.pendingWordDecisions?.[key]) return
    const pendingWordDecisions = { ...state.pendingWordDecisions }
    delete pendingWordDecisions[key]
    await spacedReviewDb.wordStates.put({
      ...state,
      pendingWordDecisions: Object.keys(pendingWordDecisions).length ? pendingWordDecisions : undefined,
    })
  })
}

export function useSaveWordRecord() {
  const isRevision = useAtomValue(isReviewModeAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const { dispatch, state: typingState } = useContext(TypingContext) ?? {}

  const saveWordRecord = useCallback(
    async ({
      word,
      wrongCount,
      letterTimeArray,
      letterMistake,
      spelling,
    }: {
      word: string
      wrongCount: number
      letterTimeArray: number[]
      letterMistake: LetterMistakes
      spelling?: SpellingTrace
    }) => {
      const timing = []
      for (let i = 1; i < letterTimeArray.length; i++) {
        const diff = letterTimeArray[i] - letterTimeArray[i - 1]
        timing.push(diff)
      }

      const sourceDict = isRevision
        ? typingState?.chapterData.words[spelling?.sourceIndex ?? typingState.chapterData.index]?.sourceDict ??
          reviewModeInfo.reviewRecord?.words[reviewModeInfo.reviewRecord.index]?.sourceDict
        : undefined
      const wordRecord = new WordRecord(word, sourceDict ?? dictID, isRevision ? -1 : currentChapter, timing, wrongCount, letterMistake)
      if (spelling) {
        wordRecord.spelling = spelling
        wordRecord.spellingEvidence = spellingEvidence(spelling)
      }

      const training = isRevision ? reviewModeInfo.reviewRecord?.gptTraining : undefined
      if (training && spelling) wordRecord.gptTraining = trainingWordContext(training, spelling.sourceIndex)
      const pendingKey = training && spelling ? `${training.sessionId}:${spelling.exposureId}` : undefined
      let dbID = -1
      try {
        await runStudyWrite(async () => {
          let inserted = true
          let recordForDecision: IWordRecord = wordRecord
          if (training && spelling) {
            const saved = await import('./training-service').then(({ saveTrainingWord }) =>
              saveTrainingWord(training, wordRecord, spelling),
            )
            dbID = saved.recordId
            inserted = saved.pending
            recordForDecision = saved.record ?? wordRecord
          } else dbID = await db.wordRecords.add(wordRecord)
          const spacedReview = inserted
            ? await spacedReviewDb.transaction('rw', spacedReviewDb.wordStates, spacedReviewDb.meta, async () => {
                const identity = spacedReviewIdentity(recordForDecision.dict, recordForDecision.word)
                const previousReviewState = await spacedReviewDb.wordStates.get(wordLearningStateKey(identity))
                const appliedDecision = pendingKey && previousReviewState?.pendingWordDecisions?.[pendingKey]
                if (appliedDecision) {
                  recordForDecision.spacedReviewDecision = appliedDecision
                  return previousReviewState
                }
                const { state, ...decision } = decideSpacedReview(previousReviewState, recordForDecision, identity)
                recordForDecision.spacedReviewDecision = decision
                const pendingWordDecisions = previousReviewState?.pendingWordDecisions
                const nextState = pendingKey
                  ? { ...state, pendingWordDecisions: { ...pendingWordDecisions, [pendingKey]: decision } }
                  : pendingWordDecisions ? { ...state, pendingWordDecisions } : state
                nextState.lastRecordId = dbID
                await spacedReviewDb.wordStates.put(nextState)
                const meta = await spacedReviewDb.meta.get('schedule')
                if (meta?.algorithm === SPACED_REVIEW_ALGORITHM) {
                  await spacedReviewDb.meta.put({
                    ...meta,
                    recordCount: meta.recordCount + 1,
                    lastRecordId: Math.max(meta.lastRecordId, dbID),
                  })
                }
                return nextState
              })
            : undefined
          if (inserted && training && spelling) {
            await import('./training-service').then(({ publishTrainingWord }) =>
              publishTrainingWord(training, recordForDecision, recordForDecision.spelling ?? spelling, dbID),
            )
          } else if (inserted) {
            await db.wordRecords.update(dbID, { spacedReviewDecision: wordRecord.spacedReviewDecision })
          }
          if (pendingKey && dbID > 0) {
            try { await clearPendingWordDecision(recordForDecision, pendingKey) }
            catch (error) { console.error('Could not clear finalized training decision marker', error) }
          }
          if (!training)
            await appendCloudStudyEvent('word', {
              recordId: dbID,
              ...wordRecord,
              durationMs: wordRecord.totalTime,
              spacedReview,
            })
          await import('./spaced-review-service').then(({ scheduleAlgorithmReviewPlan }) => scheduleAlgorithmReviewPlan())
        })
      } catch (e) {
        console.error(e)
        if (training) dbID = -1
      }
      if (dispatch && !isDataRestoring()) {
        dbID > 0 && dispatch({ type: TypingStateActionType.ADD_WORD_RECORD_ID, payload: dbID, progressKey: typingState?.progressKey })
        dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: false, progressKey: typingState?.progressKey })
      }
      return dbID
    },
    [currentChapter, dictID, dispatch, isRevision, reviewModeInfo.reviewRecord, typingState?.chapterData.index, typingState?.progressKey],
  )

  return saveWordRecord
}

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await runStudyWrite(() => db.wordRecords.where({ word, dict }).delete())
      return deletedCount
    } catch (error) {
      console.error(`删除单词记录时出错：`, error)
    }
  }, [])

  return { deleteWordRecord }
}
