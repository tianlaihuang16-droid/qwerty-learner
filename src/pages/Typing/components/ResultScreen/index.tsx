import { TypingContext, TypingStateActionType } from '../../store'
import LastWordRating from '../LastWordRating'
import ShareButton from '../ShareButton'
import ConclusionBar from './ConclusionBar'
import RemarkRing from './RemarkRing'
import WordChip from './WordChip'
import Tooltip from '@/components/Tooltip'
import {
  currentChapterAtom,
  currentDictIdAtom,
  currentDictInfoAtom,
  isReviewModeAtom,
  reviewModeInfoAtom,
  wordDictationConfigAtom,
} from '@/store'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { ALL_SPACED_REVIEW_DICT_ID, generateAllSpacedReviewRecord } from '@/utils/db/spaced-review-service'
import { Transition } from '@headlessui/react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IexportWords from '~icons/icon-park-outline/excel'
import IconX from '~icons/tabler/x'

type ResultScreenProps = {
  onContinueDictionary: () => void
}

const ResultScreen = ({ onContinueDictionary }: ResultScreenProps) => {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!

  const setWordDictationConfig = useSetAtom(wordDictationConfigAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const navigate = useNavigate()

  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const isTodayReview = isReviewMode && reviewModeInfo.reviewRecord?.dict === ALL_SPACED_REVIEW_DICT_ID
  const continuingRef = useRef(false)
  const [isContinuing, setIsContinuing] = useState(false)
  const [continueMessage, setContinueMessage] = useState('')

  const continueReview = useCallback(async () => {
    const current = reviewModeInfo.reviewRecord
    if (!isTodayReview || !current || continuingRef.current) return
    continuingRef.current = true
    setIsContinuing(true)
    setContinueMessage('')
    try {
      const completed = { ...current, isFinished: true, index: Math.max(0, current.words.length - 1) }
      await putWordReviewRecord(completed)
      const next = await generateAllSpacedReviewRecord()
      if (!next) {
        setReviewModeInfo({ isReviewMode: true, reviewRecord: completed })
        setContinueMessage('当前没有剩余到期词了，稍后有单词到期时可继续复习。')
        return
      }
      const sourceDict = next.words[0]?.sourceDict
      if (sourceDict) setCurrentDictId(sourceDict)
      setCurrentChapter(-1)
      setReviewModeInfo({ isReviewMode: true, reviewRecord: next })
    } catch (error) {
      console.error('Failed to continue today review', error)
      setContinueMessage('下一组复习加载失败，请重试。')
    } finally {
      continuingRef.current = false
      setIsContinuing(false)
    }
  }, [isTodayReview, reviewModeInfo.reviewRecord, setCurrentChapter, setCurrentDictId, setReviewModeInfo])

  useEffect(() => {
    // tick a zero timer to calc the stats
    dispatch({ type: TypingStateActionType.TICK_TIMER, addTime: 0 })
  }, [dispatch])

  const exportWords = useCallback(() => {
    const { words, userInputLogs } = state.chapterData
    const exportData = userInputLogs.map((log) => {
      const word = words[log.index]
      const wordName = word.name
      return {
        ...word,
        trans: word.trans.join(';'),
        correctCount: log.correctCount,
        wrongCount: log.wrongCount,
        wrongLetters: Object.entries(log.LetterMistakes)
          .map(([key, mistakes]) => `${wordName[Number(key)]}:${mistakes.length}`)
          .join(';'),
      }
    })

    import('xlsx')
      .then(({ utils, writeFileXLSX }) => {
        const ws = utils.json_to_sheet(exportData)
        const wb = utils.book_new()
        utils.book_append_sheet(wb, ws, 'Data')
        writeFileXLSX(wb, `${currentDictInfo.name}-本轮.xlsx`)
      })
      .catch(() => {
        console.log('写入 xlsx 模块导入失败')
      })
  }, [currentDictInfo.name, state.chapterData])

  const wrongWords = useMemo(() => {
    return state.chapterData.userInputLogs
      .filter((log) => log.wrongCount > 0)
      .map((log) => state.chapterData.words[log.index])
      .filter((word) => word !== undefined)
  }, [state.chapterData.userInputLogs, state.chapterData.words])

  const correctRate = useMemo(() => {
    const chapterLength = state.chapterData.words.length
    const correctCount = chapterLength - wrongWords.length
    return Math.floor((correctCount / chapterLength) * 100)
  }, [state.chapterData.words.length, wrongWords.length])

  const mistakeLevel = useMemo(() => {
    if (correctRate >= 85) {
      return 0
    } else if (correctRate >= 70) {
      return 1
    } else {
      return 2
    }
  }, [correctRate])

  const timeString = useMemo(() => {
    const seconds = state.timerData.time
    const minutes = Math.floor(seconds / 60)
    const minuteString = minutes < 10 ? '0' + minutes : minutes + ''
    const restSeconds = seconds % 60
    const secondString = restSeconds < 10 ? '0' + restSeconds : restSeconds + ''
    return `${minuteString}:${secondString}`
  }, [state.timerData.time])

  const nextButtonHandler = useCallback(() => {
    if (isReviewMode) {
      return
    }

    setWordDictationConfig((old) => {
      if (old.isOpen) {
        if (old.openBy === 'auto') {
          return { ...old, isOpen: false }
        }
      }
      return old
    })
    onContinueDictionary()
  }, [isReviewMode, onContinueDictionary, setWordDictationConfig])

  const exitButtonHandler = useCallback(() => {
    if (isReviewMode) {
      setCurrentChapter(0)
      setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
    } else {
      navigate('/gallery')
    }
  }, [isReviewMode, navigate, setCurrentChapter, setReviewModeInfo])

  const onNavigateToGallery = useCallback(() => {
    setCurrentChapter(0)
    setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
    navigate('/gallery')
  }, [navigate, setCurrentChapter, setReviewModeInfo])

  useHotkeys(
    'enter',
    () => {
      nextButtonHandler()
    },
    { preventDefault: true },
  )

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto">
      <div className="absolute inset-0 bg-gray-300 opacity-80 dark:bg-gray-600"></div>
      <Transition
        show={true}
        enter="ease-in duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-out duration-100"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div className="flex h-screen items-center justify-center">
          <div className="my-card fixed flex w-[90vw] max-w-6xl flex-col overflow-hidden rounded-3xl bg-white pb-14 pl-10 pr-5 pt-10 shadow-lg dark:bg-gray-800 md:w-4/5 lg:w-3/5">
            <div className="text-center font-sans text-xl font-normal text-gray-900 dark:text-gray-400 md:text-2xl">
              {isReviewMode && reviewModeInfo.reviewRecord?.dict === 'spaced-review-today'
                ? 'FSRS 今日复习'
                : `${currentDictInfo.name} ${
                    isReviewMode
                      ? reviewModeInfo.reviewRecord?.mode === 'spaced'
                        ? 'FSRS 复习'
                        : '错题复习'
                      : ''
                  }`}
            </div>
            <button className="absolute right-7 top-5" onClick={exitButtonHandler} disabled={isContinuing}>
              <IconX className="text-gray-400" />
            </button>
            <p className="mt-3 text-center text-sm text-gray-500" data-testid="spelling-summary">
              本轮追加复练 {state.spellingSession.retryCompleted} 次
              {state.spellingSession.deferred.length > 0
                ? ` · ${state.spellingSession.deferred.length} 词本轮未完成复练（间隔不足、达到上限或已跳过）`
                : ' · 本轮复练已完成'}
            </p>
            {state.lastGradedRecord?.sourceIndex === state.chapterData.index &&
              state.chapterData.words[state.chapterData.index]?.name === state.lastGradedRecord.word && (
                <div className="mt-3 flex justify-center">
                  <LastWordRating word={state.lastGradedRecord.word} sourceIndex={state.lastGradedRecord.sourceIndex}
                    shortcutsEnabled showWord />
                </div>
              )}
            <div className="mt-10 flex flex-row gap-2 overflow-hidden">
              <div className="flex flex-shrink-0 flex-grow-0 flex-col gap-3 px-4 sm:px-1 md:px-2 lg:px-4">
                <RemarkRing remark={`${state.timerData.accuracy}%`} caption="正确率" percentage={state.timerData.accuracy} />
                <RemarkRing remark={timeString} caption="本轮耗时" />
                <RemarkRing remark={state.timerData.wpm + ''} caption="WPM" />
              </div>
              <div className="z-10 ml-6 flex-1 overflow-visible rounded-xl bg-indigo-50 dark:bg-gray-700">
                <div className="customized-scrollbar z-20 ml-8 mr-1 flex h-80 flex-row flex-wrap content-start gap-4 overflow-y-auto overflow-x-hidden pr-7 pt-9">
                  {wrongWords.map((word, index) => (
                    <WordChip key={`${index}-${word.name}`} word={word} />
                  ))}
                </div>
                <div className="align-center flex w-full flex-row justify-start rounded-b-xl bg-indigo-200 px-4 dark:bg-indigo-400">
                  <ConclusionBar mistakeLevel={mistakeLevel} mistakeCount={wrongWords.length} />
                </div>
              </div>
              <div className="ml-2 flex flex-col items-center justify-end gap-3 text-xl">
                {!isReviewMode && (
                  <>
                    <ShareButton />
                    <button type="button" aria-label="导出本轮" className="cursor-pointer text-gray-500" onClick={exportWords}>
                      <IexportWords fontSize={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-10 flex w-full justify-center gap-5 px-5 text-xl">
              {isTodayReview && (
                <button
                  className="my-btn-primary h-12 text-base font-bold disabled:cursor-wait disabled:opacity-60"
                  type="button"
                  onClick={continueReview}
                  disabled={isContinuing}
                  title="继续下一组到期词，最多 30 词"
                >
                  {isContinuing ? '正在加载…' : '继续复习'}
                </button>
              )}
              {!isReviewMode && (
                <Tooltip content="快捷键：enter">
                  <button
                    className="my-btn-primary h-12 text-base font-bold"
                    type="button"
                    onClick={nextButtonHandler}
                    title="继续学习"
                  >
                    继续学习
                  </button>
                </Tooltip>
              )}

              {isReviewMode && (
                <button
                  className="my-btn-primary h-12 text-base font-bold"
                  type="button"
                  onClick={onNavigateToGallery}
                  disabled={isContinuing}
                  title="返回词书"
                >
                  返回词书
                </button>
              )}
            </div>
            {continueMessage && (
              <p className="mt-4 text-center text-sm text-gray-500" role="status">
                {continueMessage}
              </p>
            )}
          </div>
        </div>
      </Transition>
    </div>
  )
}

export default ResultScreen
