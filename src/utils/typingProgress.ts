import type { TypingProgressSnapshot, TypingState } from '@/pages/Typing/store/type'
import type { WordWithIndex } from '@/typings'
import { isDataRestoring } from '@/utils/db/maintenance'
import { practiceWordKey } from '@/utils/spellingPractice'

const STORAGE_PREFIX = 'qwertyTypingProgress:v1'
const pendingProgress = new Map<string, StoredTypingProgress>()
let progressTimer: ReturnType<typeof setTimeout> | undefined

type StoredTypingProgress = {
  version: 1
  dictId: string
  chapter: number
  snapshot: TypingProgressSnapshot
}

export type TypingProgressCandidate = {
  sliceIndex: number
  wordLists: WordWithIndex[][]
  sourceWords?: WordWithIndex[]
}

export const getTypingProgressKey = (dictId: string, chapter: number) => `${STORAGE_PREFIX}:${dictId}:${chapter}`

export function saveTypingProgress(dictId: string, chapter: number, state: TypingState, force = false) {
  if (isDataRestoring()) return
  const stored: StoredTypingProgress = {
    version: 1,
    dictId,
    chapter,
    snapshot: {
      chapterData: state.chapterData,
      timerData: state.timerData,
      isTransVisible: state.isTransVisible,
      spellingSession: state.spellingSession,
      spellingDraft: state.spellingDraft,
    },
  }

  const key = getTypingProgressKey(dictId, chapter)
  pendingProgress.set(key, stored)
  if (force) {
    flushTypingProgress()
    return
  }
  if (!progressTimer) progressTimer = setTimeout(flushTypingProgress, 2000)
}

export function flushTypingProgress() {
  if (progressTimer) {
    clearTimeout(progressTimer)
    progressTimer = undefined
  }
  if (!isDataRestoring()) {
    pendingProgress.forEach((stored, key) => window.localStorage.setItem(key, JSON.stringify(stored)))
  }
  pendingProgress.clear()
}

window.addEventListener('pagehide', flushTypingProgress)
window.addEventListener('blur', flushTypingProgress)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushTypingProgress()
})

export function clearTypingProgress(dictId: string, chapter: number) {
  if (isDataRestoring()) return
  pendingProgress.delete(getTypingProgressKey(dictId, chapter))
  window.localStorage.removeItem(getTypingProgressKey(dictId, chapter))
}

export function loadTypingProgress(dictId: string, chapter: number, currentWords: WordWithIndex[]): TypingProgressSnapshot | undefined {
  flushTypingProgress()
  const key = getTypingProgressKey(dictId, chapter)

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined

    const stored = JSON.parse(raw) as StoredTypingProgress
    const snapshot = stored?.snapshot
    const savedWords = snapshot?.chapterData?.words
    const index = snapshot?.chapterData?.index

    if (
      stored.version !== 1 ||
      stored.dictId !== dictId ||
      stored.chapter !== chapter ||
      !Array.isArray(savedWords) ||
      savedWords.length !== currentWords.length ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= savedWords.length ||
      snapshot.chapterData.userInputLogs.length !== savedWords.length
    ) {
      clearTypingProgress(dictId, chapter)
      return undefined
    }

    const currentWordMap = new Map(currentWords.map((word) => [word.index, practiceWordKey(word)]))
    const wordsStillMatch = savedWords.every((word) => currentWordMap.get(word.index) === practiceWordKey(word))
    if (!wordsStillMatch) {
      clearTypingProgress(dictId, chapter)
      return undefined
    }

    const session = snapshot.spellingSession
    if (session) {
      const validCount = (n: number) => Number.isInteger(n) && n >= 0
      const validItem = (item: (typeof session.pending)[number]) =>
        Number.isInteger(item.index) &&
        !!savedWords[item.index] &&
        practiceWordKey(savedWords[item.index]) === item.key &&
        Array.isArray(item.intervening) &&
        item.intervening.every((key) => typeof key === 'string')
      if (
        session.version !== 1 ||
        typeof session.id !== 'string' ||
        !validCount(session.mainCursor) ||
        session.mainCursor > savedWords.length ||
        !validCount(session.loopCompleted) ||
        !validCount(session.retryCompleted) ||
        !Array.isArray(session.pending) ||
        !session.pending.every(validItem) ||
        (session.activeRetry !== null && !validItem(session.activeRetry)) ||
        !session.retryCounts ||
        !Object.values(session.retryCounts).every((n) => validCount(n) && n <= 2) ||
        !Array.isArray(session.deferred) ||
        !Array.isArray(session.interrupted) ||
        (session.activeRetry ? session.activeRetry.index !== index : session.mainCursor !== index)
      ) {
        // Preserve the chapter when an optional new-format queue cannot be restored.
        snapshot.spellingSession = undefined
        snapshot.spellingDraft = undefined
      }
    }
    const draft = snapshot.spellingDraft
    if (
      draft &&
      (!snapshot.spellingSession ||
        draft.version !== 1 ||
        draft.sessionId !== snapshot.spellingSession.id ||
        draft.sourceIndex !== index ||
        draft.word !== savedWords[index].name ||
        !Array.isArray(draft.attempts) ||
        !draft.activeAttempt ||
        !Array.isArray(draft.activeAttempt.keys))
    )
      snapshot.spellingDraft = undefined
    return snapshot
  } catch {
    clearTypingProgress(dictId, chapter)
    return undefined
  }
}

export function loadTypingProgressForWordLists(
  dictId: string,
  chapter: number,
  candidateWordLists: WordWithIndex[][],
  sourceWords?: WordWithIndex[],
): { progress: TypingProgressSnapshot; words: WordWithIndex[] } | undefined {
  flushTypingProgress()
  const key = getTypingProgressKey(dictId, chapter)

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined
    const stored = JSON.parse(raw) as StoredTypingProgress
    const savedWords = stored?.snapshot?.chapterData?.words
    if (!Array.isArray(savedWords)) {
      loadTypingProgress(dictId, chapter, candidateWordLists[0] ?? [])
      return undefined
    }

    const legacyWords = candidateWordLists.flatMap((candidate) => {
      const currentWordMap = new Map(candidate.map((word) => [word.index, practiceWordKey(word)]))
      if (!savedWords.every((word) => currentWordMap.get(word.index) === practiceWordKey(word))) return []
      const currentWordsByIndex = new Map(candidate.map((word) => [word.index, word]))
      return [savedWords.map((word) => currentWordsByIndex.get(word.index) as WordWithIndex)]
    })[0]
    let sourceRestoredWords: WordWithIndex[] | undefined
    if (
      !legacyWords &&
      sourceWords &&
      new Set(savedWords.map((word) => word.sourceIndex)).size === savedWords.length &&
      new Set(savedWords.map((word) => word.index)).size === savedWords.length &&
      savedWords.every((word) => {
        const sourceIndex = word.sourceIndex
        return (
          typeof sourceIndex === 'number' &&
          Number.isInteger(sourceIndex) &&
          sourceIndex >= 0 &&
          sourceIndex < sourceWords.length &&
          practiceWordKey(sourceWords[sourceIndex]) === practiceWordKey(word)
        )
      })
    ) {
      sourceRestoredWords = savedWords.map((word) => ({ ...sourceWords[word.sourceIndex as number], index: word.index }))
    }
    const words = legacyWords ?? sourceRestoredWords
    if (!words) {
      loadTypingProgress(dictId, chapter, candidateWordLists[0] ?? [])
      return undefined
    }

    const progress = loadTypingProgress(dictId, chapter, words)
    return progress ? { progress, words } : undefined
  } catch {
    loadTypingProgress(dictId, chapter, candidateWordLists[0] ?? [])
    return undefined
  }
}

export function findRestorableTypingProgress(
  dictId: string,
  candidates: TypingProgressCandidate[],
): { sliceIndex: number; progress: TypingProgressSnapshot; words: WordWithIndex[] } | undefined {
  for (const candidate of candidates) {
    const restored = loadTypingProgressForWordLists(dictId, candidate.sliceIndex, candidate.wordLists, candidate.sourceWords)
    if (restored) return { sliceIndex: candidate.sliceIndex, ...restored }
  }
  return undefined
}
