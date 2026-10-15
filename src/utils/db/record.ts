import { getUTCUnixTimestamp } from '../index'
import type { Word } from '@/typings'
import type { TrainingContext, trainingWordContext } from '@/utils/gptTraining'
import type { SpellingSession, SpellingTrace } from '@/utils/spellingPractice'

export interface IWordRecord {
  gptTraining?: ReturnType<typeof trainingWordContext>
  spelling?: SpellingTrace
  spellingEvidence?: { label: string; errorPositions: number[]; inferenceOnly: boolean }
  spacedReviewDecision?: ISpacedReviewDecision
  spacedReviewPending?: boolean
  word: string
  timeStamp: number
  // 正常章节为 dictKey, 其他功能则为对应的类型
  dict: string
  // 用户可能是在 错题/其他类似组件中 进行的练习则为 null, start from 0
  chapter: number | null
  // 正确次数中输入每个字母的时间差，可以据此计算出总时间
  timing: number[]
  // 出错的次数
  wrongCount: number
  // 每个字母被错误输入成什么, index 为字母的索引, 数组内为错误的 e.key
  mistakes: LetterMistakes
}

export interface LetterMistakes {
  // 每个字母被错误输入成什么, index 为字母的索引, 数组内为错误的 e.key
  [index: number]: string[]
}

export class WordRecord implements IWordRecord {
  gptTraining?: ReturnType<typeof trainingWordContext>
  spelling?: SpellingTrace
  spellingEvidence?: { label: string; errorPositions: number[]; inferenceOnly: boolean }
  spacedReviewDecision?: ISpacedReviewDecision
  spacedReviewPending?: boolean
  word: string
  timeStamp: number
  dict: string
  chapter: number | null
  timing: number[]
  wrongCount: number
  mistakes: LetterMistakes

  constructor(word: string, dict: string, chapter: number | null, timing: number[], wrongCount: number, mistakes: LetterMistakes) {
    this.word = word
    this.timeStamp = getUTCUnixTimestamp()
    this.dict = dict
    this.chapter = chapter
    this.timing = timing
    this.wrongCount = wrongCount
    this.mistakes = mistakes
  }

  get totalTime() {
    return this.timing.reduce((acc, curr) => acc + curr, 0)
  }
}

export interface IChapterRecord {
  spellingSession?: SpellingSession
  // 正常章节为 dictKey, 其他功能则为对应的类型
  dict: string
  // 在错题场景中为 -1
  chapter: number | null
  timeStamp: number
  // 单位为 s，章节的记录没必要到毫秒级
  time: number
  // 正确按键次数，输对一个字母即记录
  correctCount: number
  // 错误的按键次数。 出错会清空整个输入，但只记录一次错误
  wrongCount: number
  // 用户输入的单词总数，可能会使用循环等功能使输入总数大于 20
  wordCount: number
  // 一次打对未犯错的单词列表, 可以和 wordNumber 对比得出出错的单词 indexes
  correctWordIndexes: number[]
  // 章节总单词数
  wordNumber: number
  // 单词 record 的 id 列表
  wordRecordIds: number[]
}

export class ChapterRecord implements IChapterRecord {
  spellingSession?: SpellingSession
  dict: string
  chapter: number | null
  timeStamp: number
  time: number
  correctCount: number
  wrongCount: number
  wordCount: number
  correctWordIndexes: number[]
  wordNumber: number
  wordRecordIds: number[]

  constructor(
    dict: string,
    chapter: number | null,
    time: number,
    correctCount: number,
    wrongCount: number,
    wordCount: number,
    correctWordIndexes: number[],
    wordNumber: number,
    wordRecordIds: number[],
  ) {
    this.dict = dict
    this.chapter = chapter
    this.timeStamp = getUTCUnixTimestamp()
    this.time = time
    this.correctCount = correctCount
    this.wrongCount = wrongCount
    this.wordCount = wordCount
    this.correctWordIndexes = correctWordIndexes
    this.wordNumber = wordNumber
    this.wordRecordIds = wordRecordIds
  }

  get wpm() {
    return Math.round((this.wordCount / this.time) * 60)
  }

  get inputAccuracy() {
    return Math.round((this.correctCount / this.correctCount + this.wrongCount) * 100)
  }

  get wordAccuracy() {
    return Math.round((this.correctWordIndexes.length / this.wordNumber) * 100)
  }
}

export interface IReviewRecord {
  id?: number
  dict: string
  // 当前练习进度
  index: number
  // 创建时间
  createTime: number
  // 是否已经完成
  isFinished: boolean
  // 单词列表, 根据复习算法生成和修改，可能会有重复值
  gptTraining?: TrainingContext
  words: ReviewWord[]
  mode: 'error' | 'spaced' | 'gpt'
}

export type ReviewWord = Word & {
  sourceDict?: string
}

export class ReviewRecord implements IReviewRecord {
  id?: number
  dict: string
  index: number
  createTime: number
  isFinished: boolean
  gptTraining?: TrainingContext
  words: ReviewWord[]
  mode: 'error' | 'spaced' | 'gpt'

  constructor(dict: string, words: ReviewWord[], mode: 'error' | 'spaced' | 'gpt' = 'error') {
    this.dict = dict
    this.index = 0
    this.createTime = getUTCUnixTimestamp()
    this.words = words
    this.mode = mode
    this.isFinished = false
  }
}

export type SpacedReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type SpacedReviewRatingSource = 'automatic' | 'manual'
export interface FsrsCardSnapshot {
  dueMs: number
  lastReviewMs?: number
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
}
export type SpacedReviewEvidence = 'independent' | 'assisted' | 'retry' | 'unknown'
export type SpacedReviewDueAtStart = 'due' | 'early' | 'unknown'
export type SpacedReviewReason =
  | 'new' | 'failure' | 'repeated-failure' | 'early' | 'retry' | 'assisted-retest' | 'unknown' | 'independent-due'

export interface ISpacedReviewDecision {
  algorithm: string
  rating?: SpacedReviewRating
  ratingSource?: SpacedReviewRatingSource
  /** Difficulty feedback for an exposure that did not qualify for rescheduling. */
  practiceRating?: 'easy' | 'hard'
  schedulerParamsVersion?: string
  schedulerWeights?: number[]
  fsrsCardBefore?: FsrsCardSnapshot | null
  evidence: SpacedReviewEvidence
  dueAtStart: SpacedReviewDueAtStart
  isDue: boolean
  isRetry: boolean
  stageBefore: number | null
  stageAfter: number
  dueAtBefore: number | null
  dueAtAfter: number
  exposureStartedAt?: number
  retestAt?: number
  firstKeyDelayMs?: number
  typingDurationMs?: number
  reason: SpacedReviewReason
}

export interface ISpacedReviewState {
  fsrsCard?: FsrsCardSnapshot
  lastRecordId?: number
  scope: string
  normalizedWord: string
  word: string
  sourceDicts: string[]
  preferredSourceDict: string
  stage: number
  intervalMinutes: number
  successStreak: number
  lapses: number
  totalReviews: number
  lastReviewedAt: number
  // nextReviewAt remains the long-term deadline; a short assisted retest uses retestAt.
  nextReviewAt: number
  longTermReviewAt?: number
  retestAt?: number
  lastRating: SpacedReviewRating
  // Decisions applied to this state while their GPT word record/outbox is awaiting finalization.
  pendingWordDecisions?: Record<string, ISpacedReviewDecision>
}

export interface IRevisionDictRecord {
  dict: string
  revisionIndex: number
  createdTime: number
}

export class RevisionDictRecord implements IRevisionDictRecord {
  dict: string
  revisionIndex: number
  createdTime: number

  constructor(dict: string, revisionIndex: number, createdTime: number) {
    this.dict = dict
    this.revisionIndex = revisionIndex
    this.createdTime = createdTime
  }
}

export interface IRevisionWordRecord {
  word: string
  timeStamp: number
  dict: string
  errorCount: number
}

export class RevisionWordRecord implements IRevisionWordRecord {
  word: string
  timeStamp: number
  dict: string
  errorCount: number

  constructor(word: string, dict: string, errorCount: number) {
    this.word = word
    this.timeStamp = getUTCUnixTimestamp()
    this.dict = dict
    this.errorCount = errorCount
  }
}
