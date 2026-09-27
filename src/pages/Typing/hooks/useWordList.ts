import { filterLearnedBatchWords } from './learnedWordFilter'
import { CHAPTER_LENGTH } from '@/constants'
import type { TypingProgressSnapshot } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictInfoAtom, reviewModeInfoAtom } from '@/store'
import type { Word, WordWithIndex } from '@/typings/index'
import { db, spacedReviewDb } from '@/utils/db'
import { serializedWordLearningKey, spacedReviewIdentity, wordLearningIdentity, wordLearningStateKey } from '@/utils/db/word-learning-identity'
import { dictionaryLearningKeys, findNextDictionarySlice } from '@/utils/dictionaryLearning'
import { findRestorableTypingProgress } from '@/utils/typingProgress'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import useSWR from 'swr'

export type UseWordListOptions = {
  startSlice?: number
  lockedSlice?: number
  lockedWords?: WordWithIndex[]
}

export type UseWordListResult = {
  words: WordWithIndex[]
  fullWords: WordWithIndex[]
  skippedCount: number
  allLearned: boolean
  sliceIndex: number
  dictionaryComplete: boolean
  restoredProgress?: TypingProgressSnapshot
  learningStateStatus: 'loading' | 'ready' | 'error'
  isLoading: boolean
  error: Error | undefined
}

type LearningSnapshot = {
  queryKey: string
  status: UseWordListResult['learningStateStatus']
  learnedKeys: string[]
  blacklistedKeys: string[]
}

const LOADING_SNAPSHOT: LearningSnapshot = { queryKey: '', status: 'loading', learnedKeys: [], blacklistedKeys: [] }
const NEW_WORD_BATCH_SIZE = 30

function prepareWords(words: Word[]): WordWithIndex[] {
  return words.map((word, index) => {
    let trans: string[]
    if (Array.isArray(word.trans)) trans = word.trans.filter((item) => typeof item === 'string')
    else if (word.trans === null || word.trans === undefined || typeof word.trans === 'object') trans = []
    else trans = [String(word.trans)]
    return { ...word, index, trans }
  })
}

/**
 * Use word lists from the current selected dictionary.
 */
export function useWordList(options: UseWordListOptions = {}): UseWordListResult {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const { isReviewMode, reviewRecord } = useAtomValue(reviewModeInfoAtom)
  const { data: wordList, error, isLoading: isWordListLoading } = useSWR(currentDictInfo.url, wordListFetcher)

  const reviewWords = useMemo(() => prepareWords(reviewRecord?.words ?? []), [reviewRecord?.words])
  const slices = useMemo(() => {
    if (!wordList) return []
    const sliceCount = Math.ceil(wordList.length / CHAPTER_LENGTH)
    return Array.from({ length: sliceCount }, (_, sliceIndex) => {
      const source =
        currentDictInfo.id === 'cet4' && sliceIndex === 0
          ? firstChapter
          : wordList.slice(sliceIndex * CHAPTER_LENGTH, (sliceIndex + 1) * CHAPTER_LENGTH)
      return prepareWords(source)
    })
  }, [currentDictInfo.id, wordList])
  const dictionaryWords = useMemo(() => slices.flat().map((word, sourceIndex) => ({ ...word, sourceIndex })), [slices])

  const learningQueryKey = useMemo(
    () => `${currentDictInfo.id}:${isReviewMode ? 'review' : dictionaryWords.map((word) => word.name).join('\u0000')}`,
    [currentDictInfo.id, dictionaryWords, isReviewMode],
  )

  const learningSnapshot = useLiveQuery<LearningSnapshot, LearningSnapshot>(
    async () => {
      if (isReviewMode || !wordList) return { queryKey: learningQueryKey, status: 'ready', learnedKeys: [], blacklistedKeys: [] }
      try {
        const keys = dictionaryLearningKeys(currentDictInfo.id, dictionaryWords)
        const feedbackKeys = dictionaryWords.map((word) => wordLearningStateKey(wordLearningIdentity(currentDictInfo.id, word.name)))
        const [states, feedback] = await Promise.all([
          spacedReviewDb.wordStates.bulkGet(keys),
          db.wordFeedback.bulkGet(feedbackKeys),
        ])
        return {
          queryKey: learningQueryKey,
          status: 'ready',
          learnedKeys: states.flatMap((state) => (state ? [serializedWordLearningKey(state)] : [])),
          blacklistedKeys: dictionaryWords.flatMap((word, index) =>
            feedback[index]?.blacklisted ? [serializedWordLearningKey(spacedReviewIdentity(currentDictInfo.id, word.name))] : [],
          ),
        }
      } catch (queryError) {
        console.error('Failed to read word learning states or blacklist', queryError)
        return { queryKey: learningQueryKey, status: 'error', learnedKeys: [], blacklistedKeys: [] }
      }
    },
    [learningQueryKey, wordList],
    isReviewMode ? { queryKey: learningQueryKey, status: 'ready', learnedKeys: [], blacklistedKeys: [] } : LOADING_SNAPSHOT,
  )

  if (isReviewMode) {
    return {
      words: reviewWords,
      fullWords: reviewWords,
      skippedCount: 0,
      allLearned: false,
      sliceIndex: currentChapter,
      dictionaryComplete: false,
      learningStateStatus: 'ready',
      isLoading: isWordListLoading,
      error,
    }
  }

  const currentLearningSnapshot = learningSnapshot.queryKey === learningQueryKey ? learningSnapshot : LOADING_SNAPSHOT
  const learnedKeys = new Set(currentLearningSnapshot.learnedKeys)
  const blacklistedKeys = new Set(currentLearningSnapshot.blacklistedKeys)
  const requestedStartSlice = options.startSlice ?? currentChapter
  const startSlice = requestedStartSlice >= 0 && requestedStartSlice < slices.length ? requestedStartSlice : 0
  const keyOf = (word: WordWithIndex) => serializedWordLearningKey(spacedReviewIdentity(currentDictInfo.id, word.name))

  if (error && !wordList) {
    return {
      words: [],
      fullWords: [],
      skippedCount: 0,
      allLearned: false,
      sliceIndex: startSlice,
      dictionaryComplete: false,
      learningStateStatus: 'error',
      isLoading: false,
      error,
    }
  }

  if (isWordListLoading || !wordList || currentLearningSnapshot.status === 'loading') {
    return {
      words: [],
      fullWords: [],
      skippedCount: 0,
      allLearned: false,
      sliceIndex: startSlice,
      dictionaryComplete: false,
      learningStateStatus: 'loading',
      isLoading: true,
      error,
    }
  }

  if (currentLearningSnapshot.status === 'error') {
    return {
      words: [],
      fullWords: [],
      skippedCount: 0,
      allLearned: false,
      sliceIndex: startSlice,
      dictionaryComplete: false,
      learningStateStatus: 'error',
      isLoading: false,
      error,
    }
  }

  const restored = findRestorableTypingProgress(
    currentDictInfo.id,
    slices.map((words, sliceIndex) => ({ sliceIndex, wordLists: [words], sourceWords: dictionaryWords })),
  )
  const restorableNewWord = restored?.words.slice(restored.progress.spellingSession?.mainCursor ?? restored.progress.chapterData.index).some(
    (word) => !learnedKeys.has(keyOf(word)) && !blacklistedKeys.has(keyOf(word)),
  )
  const restorableRetry = Boolean(restored?.progress.spellingSession?.activeRetry || restored?.progress.spellingSession?.pending.length)
  if (restored && (restorableNewWord || restorableRetry)) {
    const restoredWords = filterLearnedBatchWords(restored.words, learnedKeys, false, keyOf).fullWords
    return {
      words: restoredWords,
      fullWords: restoredWords,
      skippedCount: 0,
      allLearned: false,
      sliceIndex: restored.sliceIndex,
      dictionaryComplete: false,
      restoredProgress: {
        ...restored.progress,
        chapterData: { ...restored.progress.chapterData, words: restoredWords },
      },
      learningStateStatus: 'ready',
      isLoading: false,
      error,
    }
  }

  if (options.lockedSlice !== undefined && options.lockedWords?.length) {
    const fullWords = filterLearnedBatchWords(options.lockedWords, learnedKeys, false, keyOf).fullWords
    return {
      words: fullWords,
      fullWords,
      skippedCount: 0,
      allLearned: false,
      sliceIndex: options.lockedSlice,
      dictionaryComplete: false,
      learningStateStatus: 'ready',
      isLoading: false,
      error,
    }
  }

  const sliceIndex = findNextDictionarySlice(currentDictInfo.id, dictionaryWords, learnedKeys, {
    startSlice,
    includeLearned: false,
    allowWrap: true,
    excludedKeys: blacklistedKeys,
  })
  if (sliceIndex === undefined) {
    return {
      words: [],
      fullWords: [],
      skippedCount: 0,
      allLearned: dictionaryWords.length > 0 && dictionaryWords.every((word) => learnedKeys.has(keyOf(word))),
      sliceIndex: startSlice,
      dictionaryComplete: true,
      learningStateStatus: 'ready',
      isLoading: false,
      error,
    }
  }

  const orderedWords = [...dictionaryWords.slice(sliceIndex * CHAPTER_LENGTH), ...dictionaryWords.slice(0, sliceIndex * CHAPTER_LENGTH)]
  const selectedKeys = new Set<string>()
  const words: WordWithIndex[] = []
  let skippedCount = 0
  for (const word of orderedWords) {
    const key = keyOf(word)
    if (learnedKeys.has(key) || blacklistedKeys.has(key) || selectedKeys.has(key)) {
      skippedCount += 1
      continue
    }
    selectedKeys.add(key)
    words.push({ ...word, index: words.length, isLearned: false })
    if (words.length === NEW_WORD_BATCH_SIZE) break
  }
  return {
    words,
    fullWords: words,
    skippedCount,
    allLearned: false,
    sliceIndex,
    dictionaryComplete: false,
    learningStateStatus: currentLearningSnapshot.status,
    isLoading: false,
    error,
  }
}

const firstChapter = [
  { name: 'cancel', trans: ['取消， 撤销； 删去'], usphone: "'kænsl", ukphone: "'kænsl" },
  { name: 'explosive', trans: ['爆炸的； 极易引起争论的', '炸药'], usphone: "ɪk'splosɪv; ɪk'splozɪv", ukphone: "ɪk'spləusɪv" },
  { name: 'numerous', trans: ['众多的'], usphone: "'numərəs", ukphone: "'njuːmərəs" },
  { name: 'govern', trans: ['居支配地位， 占优势', '统治，治理，支配'], usphone: "'ɡʌvɚn", ukphone: "'gʌvn" },
  { name: 'analyse', trans: ['分析； 分解； 解析'], usphone: "'æn(ə)laɪz", ukphone: "'ænəlaɪz" },
  { name: 'discourage', trans: ['使泄气， 使灰心； 阻止， 劝阻'], usphone: "dɪs'kɝɪdʒ", ukphone: "dɪs'kʌrɪdʒ" },
  { name: 'resemble', trans: ['像， 类似于'], usphone: "rɪ'zɛmbl", ukphone: "rɪ'zembl" },
  {
    name: 'remote',
    trans: ['遥远的； 偏僻的； 关系疏远的； 脱离的； 微乎其微的； 孤高的， 冷淡的； 遥控的'],
    usphone: "rɪ'mot",
    ukphone: "rɪ'məut",
  },
  { name: 'salary', trans: ['薪金， 薪水'], usphone: "'sæləri", ukphone: "'sæləri" },
  { name: 'pollution', trans: ['污染， 污染物'], usphone: "pə'luʃən", ukphone: "pə'luːʃn" },
  { name: 'pretend', trans: ['装作， 假装'], usphone: "prɪ'tɛnd", ukphone: "prɪ'tend" },
  { name: 'kettle', trans: ['水壶'], usphone: "'kɛtl", ukphone: "'ketl" },
  { name: 'wreck', trans: ['失事；残骸；精神或身体已垮的人', '破坏'], usphone: 'rɛk', ukphone: 'rek' },
  { name: 'drunk', trans: ['醉的； 陶醉的'], usphone: 'drʌŋk', ukphone: 'drʌŋk' },
  { name: 'calculate', trans: ['计算； 估计； 计划'], usphone: "'kælkjulet", ukphone: "'kælkjuleɪt" },
  { name: 'persistent', trans: ['坚持的， 不屈不挠的； 持续不断的； 反复出现的'], usphone: "pə'zɪstənt", ukphone: "pə'sɪstənt" },
  { name: 'sake', trans: ['缘故， 理由'], usphone: 'sek', ukphone: 'seɪk' },
  { name: 'conceal', trans: ['把…隐藏起来， 掩盖， 隐瞒'], usphone: "kən'sil", ukphone: "kən'siːl" },
  { name: 'audience', trans: ['听众， 观众， 读者'], usphone: "'ɔdɪəns", ukphone: "'ɔːdiəns" },
  { name: 'meanwhile', trans: ['与此同时'], usphone: "'minwaɪl", ukphone: "'miːnwaɪl" },
]
