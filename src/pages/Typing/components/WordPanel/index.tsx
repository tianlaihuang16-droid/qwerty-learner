import { TypingContext, TypingStateActionType } from '../../store'
import PrevAndNextWord from '../PrevAndNextWord'
import Progress from '../Progress'
import WordFeedbackControls from './WordFeedbackControls'
import Phonetic from './components/Phonetic'
import Translation from './components/Translation'
import WordComponent from './components/Word'
import {
  currentDictIdAtom,
  isReviewModeAtom,
  isShowPrevAndNextWordAtom,
  loopWordConfigAtom,
  phoneticConfigAtom,
  reviewModeInfoAtom,
} from '@/store'
import { listBlacklistedWords } from '@/utils/db/word-feedback-service'
import { listMissingReviewWordKeys } from '@/utils/db/spaced-review-service'
import { serializedWordLearningKey, spacedReviewIdentity, wordLearningIdentity } from '@/utils/db/word-learning-identity'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'

export default function WordPanel({ feedbackTarget }: { feedbackTarget: HTMLDivElement | null }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const phoneticConfig = useAtomValue(phoneticConfigAtom)
  const isShowPrevAndNextWord = useAtomValue(isShowPrevAndNextWordAtom)
  const { times } = useAtomValue(loopWordConfigAtom)
  const reviewInfo = useAtomValue(reviewModeInfoAtom)
  const training = reviewInfo.isReviewMode ? reviewInfo.reviewRecord?.gptTraining : undefined
  const currentDictId = useAtomValue(currentDictIdAtom)
  const loopWordTimes = training ? 1 : times
  const currentWord = state.chapterData.words[state.chapterData.index]
  const sourceDict = currentWord?.sourceDict ?? currentDictId
  const blacklistedWords = useLiveQuery(() => listBlacklistedWords(), [])
  const currentWordKey = currentWord ? serializedWordLearningKey(wordLearningIdentity(sourceDict, currentWord.name)) : undefined
  const isBlacklisted = blacklistedWords?.some((feedback) => serializedWordLearningKey(feedback) === currentWordKey) ?? false
  const missingReviewKeys = useLiveQuery(() => reviewInfo.isReviewMode && reviewInfo.reviewRecord?.mode === 'spaced'
    ? listMissingReviewWordKeys(reviewInfo.reviewRecord.words, reviewInfo.reviewRecord.dict)
    : Promise.resolve<string[]>([]), [reviewInfo.reviewRecord?.id, reviewInfo.reviewRecord?.words])
  const reviewWordKey = currentWord ? serializedWordLearningKey(spacedReviewIdentity(sourceDict, currentWord.name)) : undefined
  const checkingReviewWords = reviewInfo.isReviewMode && reviewInfo.reviewRecord?.mode === 'spaced' && missingReviewKeys === undefined
  const isMissingReviewWord = reviewWordKey !== undefined && missingReviewKeys?.includes(reviewWordKey) === true
  const skippedBlacklistedExposure = useRef('')
  const exposureKey = `${state.spellingSession.id}:${state.chapterData.index}:${state.spellingSession.activeRetry?.key ?? 'main'}`
  const skipBlacklistedWord = useCallback(() => {
    if (state.isSavingRecord || skippedBlacklistedExposure.current === exposureKey) return
    skippedBlacklistedExposure.current = exposureKey
    dispatch({ type: TypingStateActionType.SKIP_WORD })
  }, [dispatch, exposureKey, state.isSavingRecord])

  useEffect(() => {
    if (isBlacklisted) skipBlacklistedWord()
  }, [isBlacklisted, skipBlacklistedWord])
  useEffect(() => {
    if (isMissingReviewWord) skipBlacklistedWord()
  }, [isMissingReviewWord, skipBlacklistedWord])
  const wordComponentKey = `${state.spellingSession.id}:${state.chapterData.index}:${state.spellingSession.loopCompleted}:${
    state.spellingSession.retryCompleted
  }:${state.spellingSession.activeRetry?.key ?? 'main'}`

  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const isPreviouslyLearned = !isReviewMode && !state.spellingSession.activeRetry && currentWord?.isLearned === true

  useEffect(() => {
    if (isPreviouslyLearned) skipBlacklistedWord()
  }, [isPreviouslyLearned, skipBlacklistedWord])

  const prevIndex = useMemo(() => {
    const newIndex = (state.spellingSession.activeRetry ? state.spellingSession.mainCursor : state.chapterData.index) - 1
    return newIndex < 0 ? 0 : newIndex
  }, [state.chapterData.index, state.spellingSession.activeRetry, state.spellingSession.mainCursor])
  const nextIndex = useMemo(() => {
    const newIndex = state.spellingSession.activeRetry ? state.spellingSession.mainCursor : state.chapterData.index + 1
    return newIndex > state.chapterData.words.length - 1 ? state.chapterData.words.length - 1 : newIndex
  }, [state.chapterData.index, state.chapterData.words.length, state.spellingSession.activeRetry, state.spellingSession.mainCursor])

  useEffect(() => {
    if (!isReviewMode || !state.chapterData.words.length) return
    setReviewModeInfo((old) => ({
      ...old,
      reviewRecord: old.reviewRecord
        ? {
            ...old.reviewRecord,
            index: Math.min(state.spellingSession.mainCursor, state.chapterData.words.length - 1),
            isFinished: state.isFinished,
          }
        : undefined,
    }))
  }, [isReviewMode, setReviewModeInfo, state.spellingSession.mainCursor, state.isFinished, state.chapterData.words.length])

  const onFinish = useCallback(
    (wrongCount: number) => {
      dispatch({ type: TypingStateActionType.COMPLETE_SPELLING_WORD, wrongCount, loopTimes: loopWordTimes })
    },
    [dispatch, loopWordTimes],
  )

  const onSkipWord = useCallback(
    (type: 'prev' | 'next') => {
      if (training) return
      if (type === 'prev') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: prevIndex })
      }

      if (type === 'next') {
        dispatch(
          state.spellingSession.activeRetry
            ? { type: TypingStateActionType.SKIP_WORD }
            : { type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: nextIndex },
        )
      }
    },
    [dispatch, prevIndex, nextIndex, state.spellingSession.activeRetry, training],
  )

  useHotkeys(
    'Ctrl + Shift + ArrowLeft',
    (e) => {
      e.preventDefault()
      onSkipWord('prev')
    },
    { preventDefault: true },
  )

  useHotkeys(
    'Ctrl + Shift + ArrowRight',
    (e) => {
      e.preventDefault()
      onSkipWord('next')
    },
    { preventDefault: true },
  )
  const [isShowTranslation, setIsHoveringTranslation] = useState(false)

  const handleShowTranslation = useCallback((checked: boolean) => {
    setIsHoveringTranslation(checked)
  }, [])

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(false)
    },
    { enableOnFormTags: true, keyup: true, preventDefault: true },
    [],
  )

  const shouldShowTranslation = useMemo(() => {
    return isShowTranslation || state.isTransVisible
  }, [isShowTranslation, state.isTransVisible])

  return (
    <div className="container flex h-full w-full flex-col items-center justify-center">
      <div className="practice-word-navigation container flex h-24 w-full shrink-0 grow-0 justify-between px-12 pt-10">
        {!training && isShowPrevAndNextWord && state.isTyping && (
          <>
            <PrevAndNextWord type="prev" />
            <div className="hidden sm:block"><PrevAndNextWord type="next" /></div>
          </>
        )}
      </div>
      <div className="container flex flex-grow flex-col items-center justify-center">
        {currentWord && (
          <div className="relative flex w-full justify-center">
            {!state.isTyping && (
              <div className="pointer-events-none absolute flex h-full w-full justify-center">
                <div className="z-10 flex w-full items-center backdrop-blur-sm">
                  <p className="w-full select-none text-center text-xl text-gray-600 dark:text-gray-50">
                    {state.isAudioReady ? (
                      <><span className="sm:hidden">点击开始{state.timerData.time ? '继续' : '练习'}</span><span className="hidden sm:inline">按任意键{state.timerData.time ? '继续' : '开始'}</span></>
                    ) : '正在准备整组读音'}
                  </p>
                </div>
              </div>
            )}
            <div className="relative max-w-full">
              <div className="mb-4 text-center text-sm text-gray-500" data-testid="spelling-status">
                {state.spellingSession.activeRetry ? '错词穿插复练' : '本轮练习'} · 本轮进度 {state.spellingSession.mainCursor}/
                {state.chapterData.words.length}
                {' · '}已复练 {state.spellingSession.retryCompleted} 次 · 待复练{' '}
                {state.spellingSession.pending.length + (state.spellingSession.activeRetry ? 1 : 0)} 词
              </div>
              {blacklistedWords === undefined || checkingReviewWords ? (
                <p className="text-sm text-gray-500">正在检查词条反馈…</p>
              ) : isBlacklisted || isPreviouslyLearned || isMissingReviewWord ? (
                <p className="text-sm text-gray-500">{isBlacklisted ? '已拉黑' : isMissingReviewWord ? '词书已无此词' : '已学习'}，正在跳过…</p>
              ) : (
                <>
                  <WordComponent word={currentWord} onFinish={onFinish} key={wordComponentKey} />
                  {phoneticConfig.isOpen && <Phonetic word={currentWord} />}
                  <Translation
                    trans={currentWord.trans.join('；')}
                    showTrans={shouldShowTranslation}
                    onMouseEnter={() => handleShowTranslation(true)}
                    onMouseLeave={() => handleShowTranslation(false)}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <Progress className={`mb-10 mt-auto ${state.isTyping ? 'opacity-100' : 'opacity-0'}`} />
      {currentWord && blacklistedWords !== undefined && !checkingReviewWords && !isMissingReviewWord && !isBlacklisted && !isPreviouslyLearned && feedbackTarget &&
        createPortal(
          <WordFeedbackControls key={currentWordKey} word={currentWord} sourceDict={sourceDict} onSkip={skipBlacklistedWord} />,
          feedbackTarget,
        )}
    </div>
  )
}
