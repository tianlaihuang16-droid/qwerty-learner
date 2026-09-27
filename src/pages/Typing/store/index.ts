import type { TypingProgressSnapshot, TypingState, UserInputLog } from './type'
import type { WordWithIndex } from '@/typings'
import type { LetterMistakes } from '@/utils/db/record'
import '@/utils/db/review-record'
import { mergeLetterMistake } from '@/utils/db/utils'
import shuffle from '@/utils/shuffle'
import { completeSpellingWord, newSpellingSession, skipSpellingWord } from '@/utils/spellingPractice'
import type { SpellingTrace } from '@/utils/spellingPractice'
import { createContext } from 'react'

export const initialState: TypingState = {
  isAudioReady: false,
  isAudioTimingPending: false,
  progressKey: '',
  chapterData: {
    words: [],
    index: 0,
    wordCount: 0,
    correctCount: 0,
    wrongCount: 0,
    wordRecordIds: [],
    userInputLogs: [],
  },
  timerData: {
    time: 0,
    accuracy: 0,
    wpm: 0,
  },
  isTyping: false,
  isFinished: false,
  isShowSkip: false,
  isTransVisible: true,
  isLoopSingleWord: false,
  isSavingRecord: false,
  spellingSession: newSpellingSession(),
}

export const initialUserInputLog: UserInputLog = {
  index: 0,
  correctCount: 0,
  wrongCount: 0,
  LetterMistakes: {},
}

export enum TypingStateActionType {
  SET_AUDIO_READY = 'SET_AUDIO_READY',
  SET_AUDIO_TIMING_PENDING = 'SET_AUDIO_TIMING_PENDING',
  COMPLETE_SPELLING_WORD = 'COMPLETE_SPELLING_WORD',
  SET_SPELLING_DRAFT = 'SET_SPELLING_DRAFT',
  SETUP_CHAPTER = 'SETUP_CHAPTER',
  SET_IS_SKIP = 'SET_IS_SKIP',
  SET_IS_TYPING = 'SET_IS_TYPING',
  TOGGLE_IS_TYPING = 'TOGGLE_IS_TYPING',
  REPORT_WRONG_WORD = 'REPORT_WRONG_WORD',
  REPORT_CORRECT_WORD = 'REPORT_CORRECT_WORD',
  NEXT_WORD = 'NEXT_WORD',
  LOOP_CURRENT_WORD = 'LOOP_CURRENT_WORD',
  FINISH_CHAPTER = 'FINISH_CHAPTER',
  INCREASE_WRONG_WORD = 'INCREASE_WRONG_WORD',
  SKIP_WORD = 'SKIP_WORD',
  SKIP_2_WORD_INDEX = 'SKIP_2_WORD_INDEX',
  REPEAT_CHAPTER = 'REPEAT_CHAPTER',
  NEXT_CHAPTER = 'NEXT_CHAPTER',
  TOGGLE_WORD_VISIBLE = 'TOGGLE_WORD_VISIBLE',
  TOGGLE_TRANS_VISIBLE = 'TOGGLE_TRANS_VISIBLE',
  TICK_TIMER = 'TICK_TIMER',
  ADD_WORD_RECORD_ID = 'ADD_WORD_RECORD_ID',
  SET_IS_SAVING_RECORD = 'SET_IS_SAVING_RECORD',
  SET_IS_LOOP_SINGLE_WORD = 'SET_IS_LOOP_SINGLE_WORD',
  TOGGLE_IS_LOOP_SINGLE_WORD = 'TOGGLE_IS_LOOP_SINGLE_WORD',
  SET_REVISION_INDEX = 'SET_REVISION_INDEX',
  SET_LAST_GRADED_RECORD = 'SET_LAST_GRADED_RECORD',
}

export type TypingStateAction =
  | { type: TypingStateActionType.SET_LAST_GRADED_RECORD; record: NonNullable<TypingState['lastGradedRecord']> }
  | { type: TypingStateActionType.SET_AUDIO_READY; ready: boolean }
  | { type: TypingStateActionType.SET_AUDIO_TIMING_PENDING; pending: boolean }
  | { type: TypingStateActionType.COMPLETE_SPELLING_WORD; wrongCount: number; loopTimes: number }
  | { type: TypingStateActionType.SET_SPELLING_DRAFT; trace: SpellingTrace }
  | {
      type: TypingStateActionType.SETUP_CHAPTER
      payload: {
        words: WordWithIndex[]
        trainingSessionId?: string
        shouldShuffle: boolean
        progressKey: string
        initialIndex?: number
        progress?: TypingProgressSnapshot
      }
    }
  | { type: TypingStateActionType.SET_IS_SKIP; payload: boolean }
  | { type: TypingStateActionType.SET_IS_TYPING; payload: boolean }
  | { type: TypingStateActionType.TOGGLE_IS_TYPING }
  | { type: TypingStateActionType.REPORT_WRONG_WORD; payload: { letterMistake: LetterMistakes } }
  | { type: TypingStateActionType.REPORT_CORRECT_WORD }
  | {
      type: TypingStateActionType.NEXT_WORD
      payload?: {
        updateReviewRecord?: (state: TypingState) => void
      }
    }
  | { type: TypingStateActionType.LOOP_CURRENT_WORD }
  | { type: TypingStateActionType.FINISH_CHAPTER }
  | { type: TypingStateActionType.SKIP_WORD }
  | { type: TypingStateActionType.SKIP_2_WORD_INDEX; newIndex: number }
  | { type: TypingStateActionType.REPEAT_CHAPTER; shouldShuffle: boolean }
  | { type: TypingStateActionType.NEXT_CHAPTER }
  | { type: TypingStateActionType.TOGGLE_TRANS_VISIBLE }
  | { type: TypingStateActionType.TICK_TIMER; addTime?: number }
  | { type: TypingStateActionType.ADD_WORD_RECORD_ID; payload: number; progressKey?: string }
  | { type: TypingStateActionType.SET_IS_SAVING_RECORD; payload: boolean; progressKey?: string }
  | { type: TypingStateActionType.SET_IS_LOOP_SINGLE_WORD; payload: boolean }
  | { type: TypingStateActionType.TOGGLE_IS_LOOP_SINGLE_WORD }

type Dispatch = (action: TypingStateAction) => void

export const typingReducer = (state: TypingState, action: TypingStateAction) => {
  switch (action.type) {
    case TypingStateActionType.SET_LAST_GRADED_RECORD:
      state.lastGradedRecord = action.record
      break
    case TypingStateActionType.SET_AUDIO_READY:
      state.isAudioReady = action.ready
      if (!action.ready) state.isTyping = false
      break
    case TypingStateActionType.SET_AUDIO_TIMING_PENDING:
      state.isAudioTimingPending = action.pending
      break
    case TypingStateActionType.SET_SPELLING_DRAFT:
      if (action.trace.sessionId === state.spellingSession.id && action.trace.sourceIndex === state.chapterData.index)
        state.spellingDraft = action.trace
      break
    case TypingStateActionType.COMPLETE_SPELLING_WORD: {
      const next = completeSpellingWord(
        state.spellingSession,
        state.chapterData.words,
        state.chapterData.index,
        action.wrongCount,
        action.loopTimes,
      )
      state.spellingDraft = undefined
      state.chapterData.wordCount++
      state.chapterData.index = next.index
      state.isFinished = next.finished
      if (next.finished) state.isTyping = false
      state.isShowSkip = false
      break
    }
    case TypingStateActionType.SETUP_CHAPTER: {
      const newState = structuredClone(initialState)
      newState.spellingSession = newSpellingSession(action.payload.initialIndex ?? 0)
      if (action.payload.trainingSessionId) newState.spellingSession.id = action.payload.trainingSessionId

      if (action.payload.progress) {
        newState.chapterData = structuredClone(action.payload.progress.chapterData)
        newState.timerData = structuredClone(action.payload.progress.timerData)
        newState.isTransVisible = action.payload.progress.isTransVisible
        newState.progressKey = action.payload.progressKey
        newState.spellingSession = structuredClone(
          action.payload.progress.spellingSession ?? newSpellingSession(newState.chapterData.index),
        )
        newState.spellingDraft = action.payload.progress.spellingDraft
        return newState
      }

      const words = action.payload.shouldShuffle ? shuffle(action.payload.words) : action.payload.words
      let initialIndex = action.payload.initialIndex ?? 0
      if (initialIndex >= words.length) {
        initialIndex = 0
      }
      newState.chapterData.index = initialIndex
      newState.spellingSession.mainCursor = initialIndex
      newState.chapterData.words = words
      newState.chapterData.userInputLogs = words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))
      newState.progressKey = action.payload.progressKey

      return newState
    }
    case TypingStateActionType.SET_IS_SKIP:
      state.isShowSkip = action.payload
      break
    case TypingStateActionType.SET_IS_TYPING:
      state.isTyping = action.payload && state.isAudioReady
      break

    case TypingStateActionType.TOGGLE_IS_TYPING:
      state.isTyping = !state.isTyping && state.isAudioReady
      break
    case TypingStateActionType.REPORT_CORRECT_WORD: {
      state.chapterData.correctCount += 1

      const wordLog = state.chapterData.userInputLogs[state.chapterData.index]
      wordLog.correctCount += 1
      break
    }
    case TypingStateActionType.REPORT_WRONG_WORD: {
      state.chapterData.wrongCount += 1

      const letterMistake = action.payload.letterMistake
      const wordLog = state.chapterData.userInputLogs[state.chapterData.index]
      wordLog.wrongCount += 1
      wordLog.LetterMistakes = mergeLetterMistake(wordLog.LetterMistakes, letterMistake)
      break
    }
    case TypingStateActionType.NEXT_WORD: {
      state.chapterData.index += 1
      state.chapterData.wordCount += 1
      state.isShowSkip = false

      if (action?.payload?.updateReviewRecord) {
        action.payload.updateReviewRecord(state)
      }
      break
    }
    case TypingStateActionType.LOOP_CURRENT_WORD:
      state.isShowSkip = false
      state.chapterData.wordCount += 1
      break
    case TypingStateActionType.FINISH_CHAPTER:
      state.chapterData.wordCount += 1
      state.isTyping = false
      state.isFinished = true
      state.isShowSkip = false
      break
    case TypingStateActionType.SKIP_WORD: {
      if (state.isSavingRecord) break
      if (state.spellingDraft) state.spellingSession.interrupted.push(state.spellingDraft)
      state.spellingDraft = undefined
      const next = skipSpellingWord(state.spellingSession, state.chapterData.words, state.chapterData.index)
      state.chapterData.index = next.index
      state.isFinished = next.finished
      if (next.finished) state.isTyping = false
      state.isShowSkip = false
      break
    }
    case TypingStateActionType.SKIP_2_WORD_INDEX: {
      if (state.isSavingRecord) break
      if (action.newIndex === state.chapterData.index && !state.spellingSession.activeRetry) break
      if (state.spellingDraft) state.spellingSession.interrupted.push(state.spellingDraft)
      state.spellingDraft = undefined
      const retryKey = state.spellingSession.activeRetry?.key
      if (retryKey && !state.spellingSession.deferred.includes(retryKey)) state.spellingSession.deferred.push(retryKey)
      const newIndex = action.newIndex
      if (newIndex >= state.chapterData.words.length) {
        state.isTyping = false
        state.isFinished = true
      }
      state.chapterData.index = Math.max(0, Math.min(newIndex, state.chapterData.words.length - 1))
      state.spellingSession.mainCursor = newIndex
      state.spellingSession.activeRetry = null
      state.spellingSession.loopCompleted = 0
      break
    }
    case TypingStateActionType.REPEAT_CHAPTER: {
      const newState = structuredClone(initialState)
      newState.isAudioReady = state.isAudioReady
      newState.spellingSession = newSpellingSession()
      newState.progressKey = state.progressKey
      newState.chapterData.userInputLogs = state.chapterData.words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))
      newState.isTyping = state.isAudioReady
      newState.chapterData.words = action.shouldShuffle ? shuffle(state.chapterData.words) : state.chapterData.words
      newState.isTransVisible = state.isTransVisible
      return newState
    }
    case TypingStateActionType.NEXT_CHAPTER: {
      const newState = structuredClone(initialState)
      newState.spellingSession = newSpellingSession()
      newState.chapterData.userInputLogs = state.chapterData.words.map((_, index) => ({ ...structuredClone(initialUserInputLog), index }))
      newState.isTyping = false
      newState.isTransVisible = state.isTransVisible
      return newState
    }
    case TypingStateActionType.TOGGLE_TRANS_VISIBLE:
      state.isTransVisible = !state.isTransVisible
      break
    case TypingStateActionType.TICK_TIMER: {
      const increment = action.addTime === undefined ? 1 : action.addTime
      const newTime = state.timerData.time + increment
      const inputSum =
        state.chapterData.correctCount + state.chapterData.wrongCount === 0
          ? 1
          : state.chapterData.correctCount + state.chapterData.wrongCount

      state.timerData.time = newTime
      state.timerData.accuracy = Math.round((state.chapterData.correctCount / inputSum) * 100)
      state.timerData.wpm = Math.round((state.chapterData.wordCount / newTime) * 60)
      break
    }
    case TypingStateActionType.ADD_WORD_RECORD_ID: {
      if (action.progressKey !== undefined && action.progressKey !== state.progressKey) break
      state.chapterData.wordRecordIds.push(action.payload)
      break
    }
    case TypingStateActionType.SET_IS_SAVING_RECORD: {
      if (action.progressKey !== undefined && action.progressKey !== state.progressKey) break
      state.isSavingRecord = action.payload
      break
    }
    case TypingStateActionType.SET_IS_LOOP_SINGLE_WORD: {
      state.isLoopSingleWord = action.payload
      break
    }
    case TypingStateActionType.TOGGLE_IS_LOOP_SINGLE_WORD: {
      state.isLoopSingleWord = !state.isLoopSingleWord
      break
    }
    default: {
      return state
    }
  }
}

export const TypingContext = createContext<{ state: TypingState; dispatch: Dispatch } | null>(null)
