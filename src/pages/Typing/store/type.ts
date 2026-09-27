import type { WordWithIndex } from '@/typings'
import type { LetterMistakes } from '@/utils/db/record'
import type { SpellingSession, SpellingTrace } from '@/utils/spellingPractice'

export type ChapterData = {
  // warning: 因为有章节内随机的存在，所有记录 index 的场景都应该使用 WordWithIndex.index
  words: WordWithIndex[]
  // chapter index
  index: number
  // 输入的单词数
  wordCount: number
  // 输入正确的单词数
  correctCount: number
  // 输入错误的单词数
  wrongCount: number
  // 每个单词的输入记录
  userInputLogs: UserInputLog[]
  // 本批次用户输入的单词 record id 列表
  wordRecordIds: number[]
}

export type UserInputLog = {
  // the index in ChapterData.words, not the index in WordWithIndex
  index: number
  correctCount: number
  wrongCount: number
  LetterMistakes: LetterMistakes
}

export type TimerData = {
  time: number
  accuracy: number
  wpm: number
}

export type WrongWordData = {
  name: string
  wrongCount: number
  wrongLetters: Array<{
    letter: string
    count: number
  }>
}

export type TypingState = {
  lastGradedRecord?: { id: number; word: string; sourceIndex: number; sessionId: string }
  isAudioReady: boolean
  isAudioTimingPending: boolean
  // Identifies the dictionary/chapter whose resumable progress is currently loaded.
  progressKey: string
  chapterData: ChapterData
  timerData: TimerData
  isTyping: boolean
  isFinished: boolean
  isShowSkip: boolean
  isTransVisible: boolean
  isLoopSingleWord: boolean
  // 是否正在保存数据
  isSavingRecord: boolean
  spellingSession: SpellingSession
  spellingDraft?: SpellingTrace
}

export type TypingProgressSnapshot = {
  chapterData: ChapterData
  timerData: TimerData
  isTransVisible: boolean
  spellingSession?: SpellingSession
  spellingDraft?: SpellingTrace
}
