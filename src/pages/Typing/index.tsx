import Layout from '../../components/Layout'
import { DictChapterButton } from './components/DictChapterButton'
import DictionaryCompleteState from './components/DictionaryCompleteState'
import { TrainingGuard, TrainingResult, useTrainingPersistence } from './components/GptTraining'
import PronunciationSwitcher from './components/PronunciationSwitcher'
import ResultScreen from './components/ResultScreen'
import Speed from './components/Speed'
import StartButton from './components/StartButton'
import Switcher from './components/Switcher'
import WordList from './components/WordList'
import WordPanel from './components/WordPanel'
import { useConfetti } from './hooks/useConfetti'
import { useWordList } from './hooks/useWordList'
import { TypingContext, TypingStateActionType, initialState, typingReducer } from './store'
import type { TypingState } from './store/type'
import Header from '@/components/Header'
import Tooltip from '@/components/Tooltip'
import { useChapterPronunciationSound } from '@/hooks/usePronunciation'
import { DEFAULT_DICTIONARY_ID, idDictionaryMap } from '@/resources/dictionary'
import {
  currentChapterAtom,
  currentDictIdAtom,
  isReviewModeAtom,
  pronunciationConfigAtom,
  randomConfigAtom,
  reviewModeInfoAtom,
} from '@/store'
import { IsDesktop, isLegal } from '@/utils'
import { syncCloudProgress } from '@/utils/cloudSync'
import { useSaveChapterRecord } from '@/utils/db'
import { useMixPanelChapterLogUploader } from '@/utils/mixpanel'
import {
  clearTypingProgress,
  flushTypingProgress,
  getTypingProgressKey,
  loadTypingProgressForWordLists,
  saveTypingProgress,
} from '@/utils/typingProgress'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useImmerReducer } from 'use-immer'

const App: React.FC<{ restored?: TypingState }> = ({ restored }) => {
  const [state, dispatch] = useImmerReducer(typingReducer, structuredClone(initialState))
  const [batchDisplayState, setBatchDisplayState] = useState<'loading' | 'ready' | 'dictionary-complete'>('loading')
  const [scanFromSlice, setScanFromSlice] = useState(0)
  const [activeBatchSlice, setActiveBatchSlice] = useState<number>()
  const [displaySkippedCount, setDisplaySkippedCount] = useState(0)
  const [feedbackTarget, setFeedbackTarget] = useState<HTMLDivElement | null>(null)
  const timerRemainderMs = useRef(0)
  const setupSignatureRef = useRef('')
  const [currentChapter, setCurrentChapter] = useAtom(currentChapterAtom)
  const [currentDictId, setCurrentDictId] = useAtom(currentDictIdAtom)
  const navigate = useNavigate()
  const { words, fullWords, skippedCount, allLearned, sliceIndex, dictionaryComplete, restoredProgress, learningStateStatus, isLoading } =
    useWordList({
      startSlice: scanFromSlice,
      lockedSlice: activeBatchSlice,
      lockedWords:
        activeBatchSlice !== undefined && state.progressKey === getTypingProgressKey(currentDictId, activeBatchSlice)
          ? state.chapterData.words
          : undefined,
    })
  const audio = useChapterPronunciationSound(
    batchDisplayState === 'ready' && !dictionaryComplete ? state.chapterData.words.map((word) => word.name) : [],
  )
  const setPronunciation = useSetAtom(pronunciationConfigAtom)
  useEffect(() => {
    if (state.isAudioReady !== audio.isReady) dispatch({ type: TypingStateActionType.SET_AUDIO_READY, ready: audio.isReady })
  }, [audio.isReady, state.isAudioReady, state.chapterData.words, dispatch])

  const randomConfig = useAtomValue(randomConfigAtom)
  const chapterLogUploader = useMixPanelChapterLogUploader(state)
  const saveChapterRecord = useSaveChapterRecord()

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const training = isReviewMode ? reviewModeInfo.reviewRecord?.gptTraining : undefined
  const trainingSaveError = useTrainingPersistence(training, state)
  const progressDictId = isReviewMode ? `review-${reviewModeInfo.reviewRecord?.id ?? 'unsaved'}` : currentDictId
  const activeSliceIndex = isReviewMode ? currentChapter : sliceIndex
  const progressKey = getTypingProgressKey(progressDictId, activeSliceIndex)
  const setupSignature = progressKey

  useEffect(() => {
    setScanFromSlice(0)
    setActiveBatchSlice(undefined)
    setBatchDisplayState('loading')
    setupSignatureRef.current = ''
  }, [currentDictId])

  useEffect(() => {
    // 检测用户设备
    if (!IsDesktop()) {
      setTimeout(() => {
        alert(
          ' Qwerty Learner 目的为提高键盘工作者的英语输入效率，目前暂未适配移动端，希望您使用桌面端浏览器访问。如您使用的是 Ipad 等平板电脑设备，可以使用外接键盘使用本软件。',
        )
      }, 500)
    }
  }, [])

  // 在组件挂载和currentDictId改变时，检查当前字典是否存在，如果不存在，则将其重置为默认值
  useEffect(() => {
    const id = currentDictId
    if (!(id in idDictionaryMap)) {
      setCurrentDictId(DEFAULT_DICTIONARY_ID)
      setCurrentChapter(0)
      return
    }
  }, [currentDictId, setCurrentChapter, setCurrentDictId])

  const skipWord = useCallback(() => {
    dispatch({ type: TypingStateActionType.SKIP_WORD })
  }, [dispatch])

  useEffect(() => {
    const onBlur = () => {
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    }
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('blur', onBlur)
    }
  }, [dispatch])

  useEffect(() => {
    if (!state.isTyping) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (
          !isLoading &&
          batchDisplayState === 'ready' &&
          audio.isReady &&
          e.key !== 'Enter' &&
          (isLegal(e.key) || e.key === ' ') &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          e.preventDefault()
          dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: true })
        }
      }
      window.addEventListener('keydown', onKeyDown)

      return () => window.removeEventListener('keydown', onKeyDown)
    }
  }, [state.isTyping, isLoading, batchDisplayState, audio.isReady, dispatch])

  useEffect(() => {
    if (isReviewMode || isLoading || dictionaryComplete || currentChapter === sliceIndex) return
    setBatchDisplayState('loading')
    setCurrentChapter(sliceIndex)
  }, [currentChapter, dictionaryComplete, isLoading, isReviewMode, setCurrentChapter, sliceIndex])

  useEffect(() => {
    if (isReviewMode || activeBatchSlice === undefined || isLoading || learningStateStatus !== 'ready' || words.length > 0 || state.isFinished) return
    setBatchDisplayState('loading')
    setActiveBatchSlice(undefined)
    setupSignatureRef.current = ''
  }, [activeBatchSlice, isLoading, isReviewMode, learningStateStatus, state.isFinished, words.length])

  useEffect(() => {
    if (isLoading || (!isReviewMode && ((!dictionaryComplete && currentChapter !== sliceIndex) || learningStateStatus === 'error' || (activeBatchSlice !== undefined && words.length === 0 && !state.isFinished)))) return
    if (!isReviewMode && dictionaryComplete) {
      setupSignatureRef.current = ''
      setDisplaySkippedCount(0)
      setBatchDisplayState('dictionary-complete')
      return
    }
    if (setupSignatureRef.current === setupSignature) return
    setupSignatureRef.current = setupSignature

    const saved = isReviewMode ? loadTypingProgressForWordLists(progressDictId, currentChapter, [fullWords, words]) : undefined
    const compatibleRestored = restored?.progressKey === progressKey ? restored : undefined
    const progress = isReviewMode ? saved?.progress ?? compatibleRestored : restoredProgress ?? compatibleRestored
    const setupWords = isReviewMode ? saved?.words ?? words : words
    const initialIndex = isReviewMode && reviewModeInfo.reviewRecord?.index ? reviewModeInfo.reviewRecord.index : 0

    dispatch({
      type: TypingStateActionType.SETUP_CHAPTER,
      payload: {
        words: setupWords,
        shouldShuffle: training ? false : randomConfig.isOpen,
        progressKey,
        initialIndex,
        progress,
        trainingSessionId: training?.sessionId,
      },
    })
    if (!isReviewMode) setActiveBatchSlice(sliceIndex)
    setDisplaySkippedCount(progress ? 0 : skippedCount)
    setBatchDisplayState('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeBatchSlice,
    currentChapter,
    dictionaryComplete,
    learningStateStatus,
    fullWords,
    isLoading,
    setupSignature,
    skippedCount,
    sliceIndex,
    state.isFinished,
    words,
  ])

  const returnToDictionary = useCallback(() => navigate('/gallery'), [navigate])

  const continueDictionary = useCallback(() => {
    if (state.isSavingRecord) return
    dispatch({ type: TypingStateActionType.NEXT_CHAPTER })
    setBatchDisplayState('loading')
    setActiveBatchSlice(undefined)
    setScanFromSlice(sliceIndex + 1)
    setupSignatureRef.current = ''
  }, [dispatch, sliceIndex, state.isSavingRecord])

  useEffect(() => {
    if (state.chapterData.words.length === 0) return

    const progressKey = getTypingProgressKey(progressDictId, activeSliceIndex)
    if (state.progressKey !== progressKey) return

    if (state.isFinished && !state.isSavingRecord) {
      if (!training) clearTypingProgress(progressDictId, activeSliceIndex)
      syncCloudProgress(
        {
          dictionaryId: currentDictId,
          chapter: activeSliceIndex,
          status: 'chapter-finished',
          chapterData: state.chapterData,
          timerData: state.timerData,
          spellingSession: state.spellingSession,
        },
        true,
      )
    } else {
      saveTypingProgress(progressDictId, activeSliceIndex, state, !state.isTyping)
      syncCloudProgress({
        dictionaryId: currentDictId,
        chapter: activeSliceIndex,
        status: state.isTyping ? 'typing' : 'paused',
        chapterData: state.chapterData,
        timerData: state.timerData,
        spellingSession: state.spellingSession,
        spellingDraft: state.spellingDraft,
      })
    }
  }, [activeSliceIndex, currentDictId, progressDictId, state, training])

  useEffect(() => () => flushTypingProgress(), [])

  useEffect(() => {
    // 当用户完成章节后且完成 word Record 数据保存，记录 chapter Record 数据,
    if (state.isFinished && !state.isSavingRecord) {
      chapterLogUploader()
      if (!training) saveChapterRecord(state)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isFinished, state.isSavingRecord])

  useEffect(() => {
    if (!state.isTyping || state.isAudioTimingPending) return
    let previous = performance.now()
    const advance = () => {
      const now = performance.now()
      timerRemainderMs.current += Math.max(0, now - previous)
      previous = now
      const seconds = Math.floor(timerRemainderMs.current / 1000)
      if (seconds > 0) {
        timerRemainderMs.current -= seconds * 1000
        dispatch({ type: TypingStateActionType.TICK_TIMER, addTime: seconds })
      }
    }
    const intervalId = window.setInterval(advance, 250)
    return () => {
      clearInterval(intervalId)
      advance()
    }
  }, [state.isTyping, state.isAudioTimingPending, dispatch])

  useConfetti(state.isFinished)

  return (
    <TypingContext.Provider value={{ state: state, dispatch }}>
      {batchDisplayState === 'ready' &&
        state.isFinished &&
        (training ? <TrainingResult context={training} state={state} /> : <ResultScreen onContinueDictionary={continueDictionary} />)}
      <Layout>
        <Header>
          <DictChapterButton />
          <PronunciationSwitcher />
          {!training && <Switcher />}
          <div ref={setFeedbackTarget} className="shrink-0" />
          <StartButton isLoading={isLoading || learningStateStatus === 'error' || batchDisplayState !== 'ready' || !audio.isReady} />
          <Tooltip content="跳过该词">
            <button
              className={`${
                batchDisplayState === 'ready' && state.isShowSkip ? 'bg-orange-400' : 'invisible w-0 bg-gray-300 px-0 opacity-0'
              } my-btn-primary transition-all duration-300 `}
              onClick={skipWord}
            >
              Skip
            </button>
          </Tooltip>
        </Header>
        <div className="container mx-auto flex h-full flex-1 flex-col items-center justify-center pb-5">
          {trainingSaveError && (
            <p role="alert" className="text-red-600">
              {trainingSaveError}
            </p>
          )}
          {learningStateStatus === 'error' && !isReviewMode && (
            <p role="alert" className="mt-3 text-sm text-amber-600 dark:text-amber-400" data-testid="learning-state-warning">
              学习状态暂时不可用；为避免混入已学词，本轮已暂停。请重启应用后重试。
            </p>
          )}
          {displaySkippedCount > 0 && batchDisplayState === 'ready' && (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400" data-testid="learned-skip-count">
              本轮已跳过 {displaySkippedCount} 个已学习或拉黑单词
            </p>
          )}
          {audio.enabled && !state.isFinished && state.chapterData.words.length > 0 && (
            <div className="mt-3 text-center text-sm text-gray-500" data-testid="chapter-audio" aria-live="polite">
              {audio.complete
                ? `本组读音已缓存 ${audio.ready}/${audio.total}`
                : `正在后台缓存本组读音 ${audio.ready}/${audio.total}，未缓存好的词不会播放`}
              {audio.synthesized > 0 && <span> · {audio.synthesized} 词使用微软离线合成读音</span>}
              {audio.complete && audio.failed.length > 0 && (
                <div className="mt-2 flex items-center justify-center gap-3">
                  <span>{audio.failed.length} 词暂时没有读音</span>
                  <button className="my-btn-primary" onClick={audio.retry}>
                    重试读音
                  </button>
                  <button className="my-btn-secondary" onClick={() => setPronunciation((old) => ({ ...old, isOpen: false }))}>
                    关闭发音继续
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="container relative mx-auto flex h-full flex-col items-center">
            <div className="container flex flex-grow items-center justify-center">
              {learningStateStatus === 'error' && !isReviewMode ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">无法确认哪些词是新词，当前不会开始普通学习。</p>
              ) : isLoading || batchDisplayState === 'loading' ? (
                <div className="flex flex-col items-center justify-center ">
                  <div
                    className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid  border-indigo-400 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                    role="status"
                  ></div>
                </div>
              ) : batchDisplayState === 'dictionary-complete' ? (
                <DictionaryCompleteState allLearned={allLearned} onReturnToDictionary={returnToDictionary} />
              ) : (
                !state.isFinished && <WordPanel feedbackTarget={feedbackTarget} />
              )}
            </div>
            <Speed />
          </div>
        </div>
      </Layout>
      {!training && batchDisplayState === 'ready' && <WordList />}
    </TypingContext.Provider>
  )
}

export default function TypingPage() {
  return <TrainingGuard>{(restored) => <App restored={restored} />}</TrainingGuard>
}
