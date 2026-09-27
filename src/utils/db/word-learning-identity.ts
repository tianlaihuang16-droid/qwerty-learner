import { idDictionaryMap } from '@/resources/dictionary'

export type WordLearningIdentity = {
  scope: string
  normalizedWord: string
}

export function learningScopeForDictionary(dictID: string) {
  return idDictionaryMap[dictID]?.language ?? `dict:${dictID}`
}

export function normalizeLearningWord(word: string, scope: string) {
  const normalized = word.normalize('NFC').trim()
  return scope === 'code' || scope.startsWith('dict:') ? normalized : normalized.toLocaleLowerCase('en-US')
}

export function wordLearningIdentity(dictID: string, word: string): WordLearningIdentity {
  const scope = learningScopeForDictionary(dictID)
  return { scope, normalizedWord: normalizeLearningWord(word, scope) }
}

export function spacedReviewIdentity(dictID: string, word: string): WordLearningIdentity {
  const identity = wordLearningIdentity(dictID, word)
  if (!isDictionaryScopedReview(dictID)) return identity
  return { scope: `dictionary:${dictID}`, normalizedWord: identity.normalizedWord }
}

export function isDictionaryScopedReview(dictID: string) {
  return idDictionaryMap[dictID]?.reviewScope === 'dictionary'
}

export function wordLearningStateKey(identity: WordLearningIdentity): [string, string] {
  return [identity.scope, identity.normalizedWord]
}

export function serializedWordLearningKey(identity: WordLearningIdentity) {
  return `${identity.scope}\u0000${identity.normalizedWord}`
}

export function mergeSourceDicts(previous: string[], next: string) {
  return [...previous.filter((dictID) => dictID !== next), next]
}
