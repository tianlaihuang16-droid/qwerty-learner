import type { WordUpdateAction } from '../InputHandler'
import InputHandler from '../InputHandler'
import Letter from './Letter'
import Notation from './Notation'
import { TipAlert } from './TipAlert'
import style from './index.module.css'
import { initialWordState } from './type'
import type { WordState } from './type'
import { alignWholeWordInput, diffWholeWordInput, editWholeWordInput } from './wholeWordInput'
import Tooltip from '@/components/Tooltip'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import { EXPLICIT_SPACE } from '@/constants'
import useKeySounds from '@/hooks/useKeySounds'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import {
  currentChapterAtom,
  currentDictInfoAtom,
  isIgnoreCaseAtom,
  isShowAnswerOnHoverAtom,
  isTextSelectableAtom,
  isWholeWordSubmitAtom,
  pronunciationIsOpenAtom,
  reviewModeInfoAtom,
  wordDictationConfigAtom,
} from '@/store'
import type { Word } from '@/typings'
import { CTRL, getUtcStringForMixpanel } from '@/utils'
import { useSaveWordRecord } from '@/utils/db'
import { acceptedEnglishSpellings, matchingSpelling } from '@/utils/englishSpellingVariants'
import { SpellingRecorder, practiceWordKey } from '@/utils/spellingPractice'
import { segmentationExplanationUrl, wordSegmentBoundaries } from '@/utils/wordSegments'
import { open } from '@tauri-apps/api/shell'
import { useAtomValue } from 'jotai'
import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useImmer } from 'use-immer'

const vowelLetters = ['A', 'E', 'I', 'O', 'U']

export default function WordComponent({ word, onFinish }: { word: Word; onFinish: (wrongCount: number) => void }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const [wordState, setWordState] = useImmer<WordState>(structuredClone(initialWordState))

  const savedDictationConfig = useAtomValue(wordDictationConfigAtom)
  const reviewInfo = useAtomValue(reviewModeInfoAtom)
  const training = reviewInfo.isReviewMode ? reviewInfo.reviewRecord?.gptTraining : undefined
  const isSpacedReview = reviewInfo.isReviewMode && reviewInfo.reviewRecord?.mode === 'spaced'
  const wordDictationConfig = training || isSpacedReview
    ? { ...savedDictationConfig, isOpen: true, type: 'hideAll' as const }
    : savedDictationConfig
  const isTextSelectable = useAtomValue(isTextSelectableAtom)
  const isIgnoreCase = useAtomValue(isIgnoreCaseAtom)
  const isShowAnswerOnHover = useAtomValue(isShowAnswerOnHoverAtom)
  const savedWholeWordSubmit = useAtomValue(isWholeWordSubmitAtom)
  const saveWordRecord = useSaveWordRecord()
  // const wordLogUploader = useMixPanelWordLogUploader(state)
  const [playKeySound, playBeepSound, playHintSound] = useKeySounds()
  const pronunciationIsOpen = useAtomValue(pronunciationIsOpenAtom)
  const [isHoveringWord, setIsHoveringWord] = useState(false)
  const [browserOpenError, setBrowserOpenError] = useState(false)
  const currentLanguage = useAtomValue(currentDictInfoAtom).language
  const currentLanguageCategory = useAtomValue(currentDictInfoAtom).languageCategory
  const acceptedSpellings = useMemo(() => acceptedEnglishSpellings(word.name.replaceAll(' ', EXPLICIT_SPACE).replaceAll('…', '..'),
    currentLanguage, word.spellings?.map(spelling => spelling.replaceAll(' ', EXPLICIT_SPACE).replaceAll('…', '..'))),
    [word.name, word.spellings, currentLanguage])
  // A valid short spelling must not finish before the user can enter its longer variant.
  const isWholeWordSubmit = savedWholeWordSubmit || acceptedSpellings.some(short =>
    acceptedSpellings.some(long => long.length > short.length && long.startsWith(short)))
  const currentChapter = useAtomValue(currentChapterAtom)

  const [showTipAlert, setShowTipAlert] = useState(false)
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)
  const recorder = useRef<SpellingRecorder>()
  const processedInput = useRef('')
  const [saveError, setSaveError] = useState(false)
  const [saveRetry, setSaveRetry] = useState(0)
  const audioTimingPending = useRef(pronunciationIsOpen)
  const typingNow = useRef(state.isTyping)
  const hasWrongNow = useRef(wordState.hasWrong)
  typingNow.current = state.isTyping
  hasWrongNow.current = wordState.hasWrong
  const syncRecorderActive = useCallback(() => {
    recorder.current?.setActive(
      typingNow.current && !hasWrongNow.current && !audioTimingPending.current &&
      document.visibilityState === 'visible' && document.hasFocus(),
    )
  }, [])
  const finishAudioTiming = useCallback(() => {
    audioTimingPending.current = false
    syncRecorderActive()
    dispatch({ type: TypingStateActionType.SET_AUDIO_TIMING_PENDING, pending: false })
  }, [dispatch, syncRecorderActive])
  const startAudioTiming = useCallback(() => {
    audioTimingPending.current = true
    syncRecorderActive()
    dispatch({ type: TypingStateActionType.SET_AUDIO_TIMING_PENDING, pending: true })
  }, [dispatch, syncRecorderActive])

  useEffect(() => {
    // run only when word changes
    let headword = ''
    try {
      headword = word.name.replace(new RegExp(' ', 'g'), EXPLICIT_SPACE)
      headword = headword.replace(new RegExp('…', 'g'), '..')
    } catch (e) {
      console.error('word.name is not a string', word)
      headword = ''
    }

    const newWordState = structuredClone(initialWordState)
    newWordState.displayWord = headword
    newWordState.letterStates = new Array(headword.length).fill('normal')
    newWordState.startTime = getUtcStringForMixpanel()
    newWordState.randomLetterVisible = headword.split('').map(() => Math.random() > 0.4)
    const restored =
      state.spellingDraft?.word === word.name && state.spellingDraft.sourceIndex === state.chapterData.index
        ? state.spellingDraft
        : undefined
    recorder.current = new SpellingRecorder(
      {
        exposureId: restored?.exposureId ?? crypto.randomUUID(),
        sessionId: state.spellingSession.id,
        sourceIndex: state.chapterData.index,
        word: word.name,
        kind: state.spellingSession.activeRetry ? 'retry' : 'main',
        retryNumber: state.spellingSession.retryCounts[practiceWordKey(word)] ?? 0,
      },
      undefined,
      restored,
    )
    syncRecorderActive()
    dispatch({ type: TypingStateActionType.SET_AUDIO_TIMING_PENDING, pending: audioTimingPending.current })
    for (const attempt of recorder.current.trace.attempts) {
      if (attempt.error) {
        newWordState.wrongCount++
        newWordState.lastErrorSlip = Boolean(attempt.error.isSlip)
        newWordState.lastWrongWord = attempt.input
        const { position, actual } = attempt.error
        newWordState.lastWrongInput = actual
        ;(newWordState.letterMistake[position] ??= []).push(actual)
      }
    }
    processedInput.current = ''
    setWordState(newWordState)
  }, [word, setWordState, syncRecorderActive, dispatch])

  useEffect(() => {
    if (!state.isTyping && pronunciationIsOpen) audioTimingPending.current = true
    const update = () => syncRecorderActive()
    const pause = () => recorder.current?.setActive(false)
    update()
    window.addEventListener('blur', pause)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      pause()
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [state.isTyping, wordState.hasWrong, pronunciationIsOpen, syncRecorderActive])

  useEffect(() => {
    if (!pronunciationIsOpen) finishAudioTiming()
  }, [pronunciationIsOpen, finishAudioTiming])

  const handleHoverWord = useCallback(
    (checked: boolean) => {
      setIsHoveringWord(checked)
      if (checked && isShowAnswerOnHover && wordDictationConfig.isOpen && recorder.current) {
        recorder.current.reveal()
        dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })
      }
    },
    [isShowAnswerOnHover, wordDictationConfig.isOpen, dispatch],
  )

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [handleHoverWord],
  )

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(false)
    },
    { enableOnFormTags: true, keyup: true, preventDefault: true },
    [handleHoverWord],
  )
  useHotkeys(
    'ctrl+j',
    () => {
      if (state.isTyping) {
        wordPronunciationIconRef.current?.play()
      }
    },
    [state.isTyping],
    { enableOnFormTags: true, preventDefault: true },
  )

  const getLetterVisible = useCallback(
    (index: number) => {
      if (wordState.letterStates[index] === 'correct' || (isShowAnswerOnHover && isHoveringWord)) return true

      if (wordDictationConfig.isOpen) {
        if (wordDictationConfig.type === 'hideAll') return false

        const letter = wordState.displayWord[index]
        if (wordDictationConfig.type === 'hideVowel') {
          return vowelLetters.includes(letter.toUpperCase()) ? false : true
        }
        if (wordDictationConfig.type === 'hideConsonant') {
          return vowelLetters.includes(letter.toUpperCase()) ? true : false
        }
        if (wordDictationConfig.type === 'randomHide') {
          return wordState.randomLetterVisible[index]
        }
      }
      return true
    },
    [
      isHoveringWord,
      isShowAnswerOnHover,
      wordDictationConfig.isOpen,
      wordDictationConfig.type,
      wordState.displayWord,
      wordState.letterStates,
      wordState.randomLetterVisible,
    ],
  )

  const updateInput = useCallback(
    (updateAction: WordUpdateAction) => {
      if (wordState.hasWrong || wordState.isFinished) return
      if (updateAction.type === 'add' && audioTimingPending.current) finishAudioTiming()

      if (!isWholeWordSubmit) {
        if (updateAction.type !== 'add') return
        if (updateAction.value === ' ') {
          updateAction.event.preventDefault()
          setWordState((state) => {
            state.inputWord = state.inputWord + EXPLICIT_SPACE
          })
        } else {
          setWordState((state) => {
            state.inputWord = state.inputWord + updateAction.value
          })
        }
        return
      }

      const key = updateAction.type === 'add' ? updateAction.value : updateAction.type === 'delete' ? 'Backspace' : ' '
      const edit = editWholeWordInput(wordState.inputWord, wordState.displayWord, key)

      if (!edit.submitted) {
        if (edit.input === wordState.inputWord) return

        if (updateAction.type === 'delete') {
          recorder.current?.backspaceDraft()
        } else {
          const visibility =
            !wordDictationConfig.isOpen || (isShowAnswerOnHover && isHoveringWord)
              ? 'full'
              : wordDictationConfig.type === 'hideAll'
              ? 'hidden'
              : 'partial'
          const added = edit.input.slice(wordState.inputWord.length)
          added.split('').forEach((inputChar, offset) => {
            recorder.current?.draftKey(
              inputChar === EXPLICIT_SPACE ? ' ' : inputChar,
              visibility,
              getLetterVisible(wordState.inputWord.length + offset),
            )
          })
          playKeySound()
        }

        setWordState((state) => {
          state.inputWord = edit.input
          if (updateAction.type === 'delete') state.letterTimeArray.pop()
          else state.letterTimeArray.push(Date.now())
        })
        if (recorder.current) dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })
        return
      }

      const accepted = matchingSpelling(wordState.inputWord, acceptedSpellings, isIgnoreCase)
      const differences = accepted ? [] : diffWholeWordInput(wordState.inputWord, wordState.displayWord, isIgnoreCase)
      const firstError = differences[0]
      const correct = differences.length === 0
      const expectedForRecord = wordState.displayWord.replaceAll(EXPLICIT_SPACE, ' ')
      recorder.current?.finishDraft(correct, expectedForRecord, firstError?.position ?? -1,
        firstError && { position: firstError.position, expected: firstError.expected.replaceAll(EXPLICIT_SPACE, ' '), actual: firstError.actual.replaceAll(EXPLICIT_SPACE, ' ') })
      if (recorder.current) dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })

      if (correct) {
        setWordState((state) => {
          if (accepted) state.displayWord = accepted
          state.letterStates = new Array(state.displayWord.length).fill('correct')
          state.correctCount += state.inputWord.length
          state.isFinished = true
          state.endTime = getUtcStringForMixpanel()
        })
        for (let index = 0; index < wordState.inputWord.length; index++) {
          dispatch({ type: TypingStateActionType.REPORT_CORRECT_WORD })
        }
        playHintSound()
        return
      }

      const mismatchIndex = firstError.position
      const actualChar = firstError.actual.replaceAll(EXPLICIT_SPACE, ' ')
      playBeepSound()
      setWordState((state) => {
        if (firstError.type !== 'missing') state.letterStates[mismatchIndex] = 'wrong'
        state.hasWrong = true
        state.hasMadeInputWrong = true
        state.wrongCount += 1
        state.lastWrongInput = actualChar
        state.lastWrongWord = state.inputWord.replaceAll(EXPLICIT_SPACE, ' ')
        state.lastErrorSlip = false
        state.letterTimeArray = []
        ;(state.letterMistake[mismatchIndex] ??= []).push(actualChar)
      })
      dispatch({ type: TypingStateActionType.REPORT_WRONG_WORD, payload: { letterMistake: { [mismatchIndex]: [actualChar] } } })
      if (currentChapter === 0 && state.chapterData.index === 0 && wordState.wrongCount >= 3) setShowTipAlert(true)
    },
    [
      acceptedSpellings,
      currentChapter,
      dispatch,
      finishAudioTiming,
      getLetterVisible,
      isHoveringWord,
      isIgnoreCase,
      isShowAnswerOnHover,
      isWholeWordSubmit,
      playBeepSound,
      playHintSound,
      playKeySound,
      setWordState,
      state.chapterData.index,
      wordDictationConfig.isOpen,
      wordDictationConfig.type,
      wordState.displayWord,
      wordState.hasWrong,
      wordState.inputWord,
      wordState.isFinished,
      wordState.wrongCount,
    ],
  )

  useEffect(() => {
    if (isWholeWordSubmit) return
    const inputLength = wordState.inputWord.length
    if (wordState.hasWrong || inputLength === 0 || wordState.displayWord.length === 0 || processedInput.current === wordState.inputWord) {
      return
    }

    const inputChar = wordState.inputWord[inputLength - 1]
    const candidate = matchingSpelling(wordState.inputWord, acceptedSpellings, isIgnoreCase, true)
    const correctChar = (candidate ?? wordState.displayWord)[inputLength - 1]
    const isEqual = candidate !== undefined
    const completed = matchingSpelling(wordState.inputWord, acceptedSpellings, isIgnoreCase) !== undefined
    processedInput.current = wordState.inputWord
    const visibility =
      !wordDictationConfig.isOpen || (isShowAnswerOnHover && isHoveringWord)
        ? 'full'
        : wordDictationConfig.type === 'hideAll'
        ? 'hidden'
        : 'partial'
    recorder.current?.key(
      inputChar === EXPLICIT_SPACE ? ' ' : inputChar,
      correctChar === EXPLICIT_SPACE ? ' ' : correctChar,
      isEqual,
      visibility,
      isEqual && completed,
      getLetterVisible(inputLength - 1),
    )
    if (recorder.current) dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })

    if (isEqual) {
      // 输入正确时
      setWordState((state) => {
        if (candidate && candidate !== state.displayWord) {
          state.displayWord = candidate
          state.letterStates = candidate.split('').map((_, index) => index < inputLength ? 'correct' : 'normal')
        }
        state.letterTimeArray.push(Date.now())
        state.correctCount += 1
      })

      if (completed) {
        // 完成输入时
        setWordState((state) => {
          state.letterStates[inputLength - 1] = 'correct'
          state.isFinished = true
          state.endTime = getUtcStringForMixpanel()
        })
        playHintSound()
      } else {
        setWordState((state) => {
          state.letterStates[inputLength - 1] = 'correct'
        })
        playKeySound()
      }

      dispatch({ type: TypingStateActionType.REPORT_CORRECT_WORD })
    } else {
      // 出错时
      playBeepSound()
      setWordState((state) => {
        state.letterStates[inputLength - 1] = 'wrong'
        state.hasWrong = true
        state.hasMadeInputWrong = true
        state.wrongCount += 1
        state.lastWrongInput = inputChar === EXPLICIT_SPACE ? ' ' : inputChar
        state.lastErrorSlip = false
        state.letterTimeArray = []

        if (state.letterMistake[inputLength - 1]) {
          state.letterMistake[inputLength - 1].push(inputChar)
        } else {
          state.letterMistake[inputLength - 1] = [inputChar]
        }
      })
      dispatch({ type: TypingStateActionType.REPORT_WRONG_WORD, payload: { letterMistake: { [inputLength - 1]: [inputChar] } } })

      if (currentChapter === 0 && state.chapterData.index === 0 && wordState.wrongCount >= 3) {
        setShowTipAlert(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.inputWord, isWholeWordSubmit])

  const markSlip = useCallback(() => {
    if (!recorder.current?.markLastErrorAsSlip()) return
    setWordState((draft) => { draft.lastErrorSlip = true })
    dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })
  }, [dispatch, setWordState])

  useEffect(() => {
    if (!state.isTyping || wordState.lastWrongInput === null || wordState.lastErrorSlip || (!wordState.hasWrong && wordState.inputWord.length > 0)) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      markSlip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [markSlip, state.isTyping, wordState.hasWrong, wordState.inputWord.length, wordState.lastErrorSlip, wordState.lastWrongInput])

  useEffect(() => {
    if (wordState.hasWrong) {
      if (pronunciationIsOpen && state.isTyping) startAudioTiming()
      const timer = setTimeout(() => {
        processedInput.current = ''
        recorder.current?.startNextAttempt()
        setWordState((state) => {
          state.inputWord = ''
          state.letterStates = new Array(state.letterStates.length).fill('normal')
          state.hasWrong = false
        })
      }, 300)

      return () => {
        clearTimeout(timer)
      }
    }
  }, [wordState.hasWrong, pronunciationIsOpen, state.isTyping, setWordState, startAudioTiming])

  useEffect(() => {
    if (wordState.isFinished) {
      let cancelled = false
      setSaveError(false)
      dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: true })

      // wordLogUploader({
      //   headword: word.name,
      //   timeStart: wordState.startTime,
      //   timeEnd: wordState.endTime,
      //   countInput: wordState.correctCount + wordState.wrongCount,
      //   countCorrect: wordState.correctCount,
      //   countTypo: wordState.wrongCount,
      // })
      const spelling = recorder.current?.snapshot()
      const correctAttempt = spelling?.attempts.filter((attempt) => attempt.outcome === 'correct').slice(-1)[0]
      void saveWordRecord({
        word: word.name,
        wrongCount: wordState.wrongCount,
        letterTimeArray: correctAttempt?.keys.map((key) => key.activeAtMs) ?? wordState.letterTimeArray,
        letterMistake: wordState.letterMistake,
        spelling,
      }).then((id) => {
        if (cancelled) return
        if (id > 0) {
          if (spelling?.kind === 'main' && spelling.sessionId === state.spellingSession.id)
            dispatch({ type: TypingStateActionType.SET_LAST_GRADED_RECORD,
              record: { id, word: word.name, sourceIndex: state.chapterData.index, sessionId: spelling.sessionId } })
          onFinish(spelling?.attempts.filter((attempt) => attempt.outcome === 'error' && !attempt.error?.isSlip).length ?? wordState.wrongCount)
        }
        else setSaveError(true)
      })
      return () => {
        cancelled = true
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.isFinished, saveRetry])

  useEffect(() => {
    if (wordState.wrongCount >= 4) {
      dispatch({ type: TypingStateActionType.SET_IS_SKIP, payload: true })
    }
  }, [wordState.wrongCount, dispatch])

  const isFullyHiddenDictation = wordDictationConfig.isOpen && wordDictationConfig.type === 'hideAll'
  const wholeWordDifferences = useMemo(() =>
    wordState.lastWrongWord === null ? [] : diffWholeWordInput(wordState.lastWrongWord, wordState.displayWord.replaceAll(EXPLICIT_SPACE, ' '), isIgnoreCase),
  [wordState.lastWrongWord, wordState.displayWord, isIgnoreCase])
  const wholeWordColumns = useMemo(() =>
    wordState.lastWrongWord === null ? [] : alignWholeWordInput(wordState.lastWrongWord, wordState.displayWord.replaceAll(EXPLICIT_SPACE, ' '), isIgnoreCase),
  [wordState.lastWrongWord, wordState.displayWord, isIgnoreCase])
  const renderedLetterCount = isWholeWordSubmit
    ? Math.max(wordState.displayWord.length, wordState.inputWord.length)
    : wordState.displayWord.length

  const segmentBoundaries = wordSegmentBoundaries(wordState.displayWord, word.segments)
  const showSegments = segmentBoundaries.length > 0 &&
    Array.from(wordState.displayWord).every((_, index) => getLetterVisible(index)) &&
    (!isWholeWordSubmit || wordState.inputWord.length === 0 || wordState.inputWord === wordState.displayWord)
  const explanationUrl = showSegments && word.segments ? segmentationExplanationUrl(word.name, word.segments) : undefined

  return (
    <>
      {saveError && (
        <button className="my-btn-primary" onClick={() => setSaveRetry((value) => value + 1)}>
          记录保存失败，点击重试
        </button>
      )}
      <div
        data-testid="spelling-word"
        data-word={word.name}
        data-input={isWholeWordSubmit ? wordState.inputWord.replaceAll(EXPLICIT_SPACE, ' ') : undefined}
        lang={currentLanguageCategory !== 'code' ? currentLanguageCategory : 'en'}
        className="flex flex-col items-center justify-center pb-1 pt-4"
      >
        {['romaji', 'hapin'].includes(currentLanguage) && word.notation && <Notation notation={word.notation} />}
        {isWholeWordSubmit && !savedWholeWordSubmit && <p className="mb-2 text-xs text-gray-500">英美拼写均可 · 空格提交</p>}
        <div
          className={`tooltip-info relative w-fit bg-transparent p-0 leading-normal shadow-none dark:bg-transparent ${
            wordDictationConfig.isOpen ? 'tooltip' : ''
          }`}
          data-tip="按 Tab 快捷键显示完整单词"
        >
          <a
            href={explanationUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={explanationUrl ? '点击让 ChatGPT 解释切分原理' : undefined}
            onClick={(event) => {
              if (!explanationUrl) return
              event.stopPropagation()
              if ('__TAURI_IPC__' in window) {
                event.preventDefault()
                setBrowserOpenError(false)
                void open(explanationUrl).catch((error) => {
                  console.error('Could not open segmentation explanation', error)
                  setBrowserOpenError(true)
                })
              }
            }}
            onMouseEnter={() => handleHoverWord(true)}
            onMouseLeave={() => handleHoverWord(false)}
            className={`relative flex items-center ${isTextSelectable && 'select-all'} justify-center ${
              isFullyHiddenDictation ? 'min-h-[4rem] min-w-[12rem] pb-2' : ''
            } ${explanationUrl ? 'cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500' : ''} ${wordState.hasWrong ? style.wrong : ''}`}
          >
            {Array.from({ length: renderedLetterCount }, (_, index) => {
              const hasWholeWordInput = isWholeWordSubmit && index < wordState.inputWord.length
              const letter = hasWholeWordInput ? wordState.inputWord[index] : wordState.displayWord[index] ?? ''
              return (
                <Fragment key={`${index}-${letter}`}>
                {showSegments && segmentBoundaries.includes(index) && (
                  <span data-testid="word-segment-boundary" aria-hidden="true"
                    className="mx-1 h-7 self-center border-l-2 border-indigo-300 dark:border-indigo-500" />
                )}
                <Letter
                  letter={letter}
                  visible={hasWholeWordInput || getLetterVisible(index)}
                  state={isWholeWordSubmit ? 'normal' : wordState.letterStates[index]}
                  hiddenPlaceholder={isFullyHiddenDictation ? '' : '_'}
                  wordLength={renderedLetterCount}
                />
                </Fragment>
              )
            })}
            {isFullyHiddenDictation && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-1/2 w-[12rem] -translate-x-1/2 border-b-2 border-gray-400/70 dark:border-gray-500"
              />
            )}
          </a>
          {browserOpenError && <p role="alert" className="mt-2 text-center text-sm text-red-600">浏览器未打开，请再次点击切分单词</p>}
          {wordState.lastWrongInput !== null && (wordState.hasWrong || wordState.inputWord.length === 0) && (
            <div className="mt-2 flex items-center justify-center gap-2 text-sm font-medium text-red-600 dark:text-red-400" aria-live="polite">
              <div className="flex flex-col items-center break-all">
                {isWholeWordSubmit && wordState.lastWrongWord !== null ? (
                  <>
                    <span className="text-xs text-gray-500 dark:text-gray-400">上次错拼 · {acceptedSpellings.length > 1 ? '下方拼写均可' : '下方为正确拼写'}</span>
                    <div data-testid="whole-word-comparison" className="mt-1 max-w-[min(90vw,42rem)] overflow-x-auto rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                      <div className="flex w-max min-w-full justify-center font-mono text-2xl font-semibold leading-tight sm:text-3xl" aria-label={`上次输入 ${wordState.lastWrongWord}，正确拼写 ${wordState.displayWord.replaceAll(EXPLICIT_SPACE, ' ')}`}>
                        {wholeWordColumns.map((column, index) => (
                          <span key={index} className="inline-flex w-[1ch] shrink-0 flex-col items-center">
                            <span data-difference={column.type} className={column.type === 'match' ? 'text-teal-600 dark:text-teal-400' : 'text-red-500 dark:text-red-400'}>
                              {column.actual || '·'}
                            </span>
                            <span className="mt-2 text-teal-600 dark:text-teal-400">{column.expected || '\u00a0'}</span>
                          </span>
                        ))}
                      </div>
                      {acceptedSpellings.length > 1 && (
                        <div data-testid="accepted-spellings" className="mt-2 text-center font-mono text-2xl font-semibold text-teal-600 dark:text-teal-400 sm:text-3xl">
                          {acceptedSpellings.filter(spelling => spelling !== wordState.displayWord).map(spelling => (
                            <div key={spelling}>{spelling.replaceAll(EXPLICIT_SPACE, ' ')}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="sr-only">上次输错的单词：{wordState.lastWrongWord}</span>
                    <div className="sr-only">
                      {wholeWordDifferences.map((difference, index) => (
                        <span key={`${difference.position}-${index}`}>
                          第{difference.position + 1}位：{difference.type === 'missing' ? `漏写 ${difference.expected}` :
                            difference.type === 'extra' ? `多写 ${difference.actual}` :
                            `把 ${difference.expected} 写成 ${difference.actual}`}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <span>上次误输入：{wordState.lastWrongInput === '' ? '漏输入' : wordState.lastWrongInput === ' ' ? '空格' : wordState.lastWrongInput}</span>
                    {acceptedSpellings.length > 1 && (
                      <div data-testid="accepted-spellings" className="mt-2 text-center font-mono text-2xl font-semibold text-teal-600 dark:text-teal-400 sm:text-3xl">
                        <span className="block font-sans text-xs text-gray-500 dark:text-gray-400">正确拼写（均可）</span>
                        {acceptedSpellings.map(spelling => <div key={spelling}>{spelling.replaceAll(EXPLICIT_SPACE, ' ')}</div>)}
                      </div>
                    )}
                  </>
                )}
              </div>
              <button type="button" onClick={markSlip} disabled={wordState.lastErrorSlip}
                className="rounded border border-current px-2 py-0.5 disabled:opacity-60">
                {wordState.lastErrorSlip ? '已标记手滑' : '手滑 ↓'}
              </button>
            </div>
          )}
          {pronunciationIsOpen && (
            <div className="absolute -right-12 top-1/2 h-9 w-9 -translate-y-1/2 transform ">
              <Tooltip content={`快捷键${CTRL} + J`}>
                <WordPronunciationIcon
                  word={word}
                  lang={currentLanguage}
                  ref={wordPronunciationIconRef}
                  className="h-full w-full"
                  autoPlay={state.isTyping && wordState.inputWord.length === 0 && !wordState.hasWrong}
                  paused={!state.isTyping}
                  onPlaybackStart={startAudioTiming}
                  onPlaybackComplete={finishAudioTiming}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </div>
      <InputHandler updateInput={updateInput} wholeWordSubmit={isWholeWordSubmit} />
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
