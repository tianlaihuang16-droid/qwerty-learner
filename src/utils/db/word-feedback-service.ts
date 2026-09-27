import { db } from '.'
import { runStudyWrite } from './maintenance'
import type { IWordFeedback, WordFeedbackAction } from './word-feedback'
import { isFeedbackActive, updateWordFeedback } from './word-feedback'
import { wordLearningIdentity, wordLearningStateKey } from './word-learning-identity'

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

export async function getWordFeedback(dictID: string, word: string) {
  return db.wordFeedback.get(wordLearningStateKey(wordLearningIdentity(dictID, word)))
}

async function applyWordFeedback(dictID: string, word: string, action: WordFeedbackAction, now = nowSeconds()) {
  const next = await runStudyWrite(() =>
    db.transaction('rw', db.wordFeedback, async () => {
      const key = wordLearningStateKey(wordLearningIdentity(dictID, word))
      const previous = await db.wordFeedback.get(key)
      const next = updateWordFeedback(previous, dictID, word, action, now)
      if (isFeedbackActive(next)) await db.wordFeedback.put(next)
      else await db.wordFeedback.delete(key)
      return next
    }),
  )
  scheduleFeedbackExport()
  return next
}

export function setWordBlacklisted(dictID: string, word: string, blacklisted: boolean) {
  return applyWordFeedback(dictID, word, { type: 'blacklist', value: blacklisted })
}

export function markWordNotHelpful(dictID: string, word: string) {
  return applyWordFeedback(dictID, word, { type: 'not-helpful' })
}

export function listWordFeedback(): Promise<IWordFeedback[]> {
  return db.wordFeedback.orderBy('updatedAt').reverse().toArray()
}

export function listBlacklistedWords(): Promise<IWordFeedback[]> {
  return db.wordFeedback
    .orderBy('updatedAt')
    .reverse()
    .filter((feedback) => feedback.blacklisted)
    .toArray()
}

export async function clearWordBlacklist(scope: string, normalizedWord: string) {
  const next = await runStudyWrite(() =>
    db.transaction('rw', db.wordFeedback, async () => {
      const key: [string, string] = [scope, normalizedWord]
      const previous = await db.wordFeedback.get(key)
      if (!previous) return undefined
      const updated: IWordFeedback = { ...previous, blacklisted: false, updatedAt: nowSeconds() }
      delete updated.blacklistedAt
      if (isFeedbackActive(updated)) await db.wordFeedback.put(updated)
      else await db.wordFeedback.delete(key)
      return updated
    }),
  )
  scheduleFeedbackExport()
  return next
}

function scheduleFeedbackExport() {
  void import('./spaced-review-service').then(({ scheduleAlgorithmReviewPlan }) => scheduleAlgorithmReviewPlan())
}
