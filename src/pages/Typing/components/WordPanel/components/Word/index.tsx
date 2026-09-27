import type { WordUpdateAction } from '../InputHandler'
import InputHandler from '../InputHandler'
import Letter from './Letter'
import Notation from './Notation'
import { TipAlert } from './TipAlert'
import style from './index.module.css'
import { initialWordState } from './type'
import type { WordState } from './type'
import { compareWholeWordInput, editWholeWordInput } from './wholeWordInput'
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
import { SpellingRecorder, practiceWordKey } from '@/utils/spellingPractice'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
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
  const isWholeWordSubmit = useAtomValue(isWholeWordSubmitAtom)
  const saveWordRecord = useSaveWordRecord()
  // const wordLogUploader = useMixPanelWordLogUploader(state)
  const [playKeySound, playBeepSound, playHintSound] = useKeySounds()
  const pronunciationIsOpen = useAtomValue(pronunciationIsOpenAtom)
  const [isHoveringWord, setIsHoveringWord] = useState(false)
  const currentLanguage = useAtomValue(currentDictInfoAtom).language
  const currentLanguageCategory = useAtomValue(currentDictInfoAtom).languageCategory
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
        const { position, actual } = attempt.error
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

      const comparison = compareWholeWordInput(wordState.inputWord, wordState.displayWord, isIgnoreCase)
      const expectedForRecord = wordState.displayWord.replaceAll(EXPLICIT_SPACE, ' ')
      recorder.current?.finishDraft(comparison.correct, expectedForRecord, comparison.mismatchIndex)
      if (recorder.current) dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })

      if (comparison.correct) {
        setWordState((state) => {
          state.letterStates = new Array(state.displayWord.length).fill('correct')
          state.correctCount += state.displayWord.length
          state.isFinished = true
          state.endTime = getUtcStringForMixpanel()
        })
        for (let index = 0; index < wordState.displayWord.length; index++) {
          dispatch({ type: TypingStateActionType.REPORT_CORRECT_WORD })
        }
        playHintSound()
        return
      }

      const mismatchIndex = comparison.mismatchIndex
      const actualChar = wordState.inputWord[mismatchIndex] === EXPLICIT_SPACE ? ' ' : wordState.inputWord[mismatchIndex] ?? ''
      playBeepSound()
      setWordState((state) => {
        state.letterStates[mismatchIndex] = 'wrong'
        state.hasWrong = true
        state.hasMadeInputWrong = true
        state.wrongCount += 1
        state.lastWrongInput = actualChar
        state.lastErrorSlip = false
        state.letterTimeArray = []
        ;(state.letterMistake[mismatchIndex] ??= []).push(actualChar)
      })
      dispatch({ type: TypingStateActionType.REPORT_WRONG_WORD, payload: { letterMistake: { [mismatchIndex]: [actualChar] } } })
      if (currentChapter === 0 && state.chapterData.index === 0 && wordState.wrongCount >= 3) setShowTipAlert(true)
    },
    [
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
    const correctChar = wordState.displayWord[inputLength - 1]
    let isEqual = false
    if (inputChar != undefined && correctChar != undefined) {
      isEqual = isIgnoreCase ? inputChar.toLowerCase() === correctChar.toLowerCase() : inputChar === correctChar
    }
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
      isEqual && inputLength >= wordState.displayWord.length,
      getLetterVisible(inputLength - 1),
    )
    if (recorder.current) dispatch({ type: TypingStateActionType.SET_SPELLING_DRAFT, trace: recorder.current.snapshot() })

    if (isEqual) {
      // 输入正确时
      setWordState((state) => {
        state.letterTimeArray.push(Date.now())
        state.correctCount += 1
      })

      if (inputLength >= wordState.displayWord.length) {
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
    if (!state.isTyping || wordState.lastWrongInput === null || wordState.lastErrorSlip) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      markSlip()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [markSlip, state.isTyping, wordState.lastErrorSlip, wordState.lastWrongInput])

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
  const renderedLetterCount = isWholeWordSubmit
    ? Math.max(wordState.displayWord.length, wordState.inputWord.length)
    : wordState.displayWord.length

  return (
    <>
      <InputHandler updateInput={updateInput} />
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
        <div
          className={`tooltip-info relative w-fit bg-transparent p-0 leading-normal shadow-none dark:bg-transparent ${
            wordDictationConfig.isOpen ? 'tooltip' : ''
          }`}
          data-tip="按 Tab 快捷键显示完整单词"
        >
          <div
            onMouseEnter={() => handleHoverWord(true)}
            onMouseLeave={() => handleHoverWord(false)}
            className={`relative flex items-center ${isTextSelectable && 'select-all'} justify-center ${
              isFullyHiddenDictation ? 'min-h-[4rem] min-w-[12rem] pb-2' : ''
            } ${wordState.hasWrong ? style.wrong : ''}`}
          >
            {Array.from({ length: renderedLetterCount }, (_, index) => {
              const hasWholeWordInput = isWholeWordSubmit && index < wordState.inputWord.length
              const letter = hasWholeWordInput ? wordState.inputWord[index] : wordState.displayWord[index] ?? ''
              return (
                <Letter
                  key={`${index}-${letter}`}
                  letter={letter}
                  visible={hasWholeWordInput || getLetterVisible(index)}
                  state={wordState.letterStates[index]}
                  hiddenPlaceholder={isFullyHiddenDictation ? '' : '_'}
                />
              )
            })}
            {isFullyHiddenDictation && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-1/2 w-[12rem] -translate-x-1/2 border-b-2 border-gray-400/70 dark:border-gray-500"
              />
            )}
          </div>
          {wordState.lastWrongInput !== null && (
            <div className="mt-2 flex items-center justify-center gap-2 text-sm font-medium text-red-600 dark:text-red-400" aria-live="polite">
              <span>上次误输入：{wordState.lastWrongInput === '' ? '漏输入' : wordState.lastWrongInput === ' ' ? '空格' : wordState.lastWrongInput}</span>
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
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
