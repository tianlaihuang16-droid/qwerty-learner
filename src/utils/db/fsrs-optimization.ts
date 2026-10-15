import type { IWordRecord } from './record'
import { serializedWordLearningKey, spacedReviewIdentity } from './word-learning-identity'

export type FsrsOptimizationItem = { cardId: number; atMs: number; reviews: { rating: number; delta_t: number }[] }
const ratings = { again: 1, hard: 2, good: 3, easy: 4 }
const changingReasons = ['new', 'failure', 'independent-due']

export function buildFsrsOptimizationDataset(records: IWordRecord[]) {
  const chains = new Map<string, { id: number; lastMs: number; reviews: FsrsOptimizationItem['reviews']; valid: boolean }>()
  const items: FsrsOptimizationItem[] = []
  let excluded = 0
  for (const row of [...records].sort((a, b) => a.timeStamp - b.timeStamp)) {
    const key = serializedWordLearningKey(spacedReviewIdentity(row.dict, row.word))
    const trace = row.spelling
    if (trace?.kind === 'retry') {
      excluded++
      continue
    }
    const decision = row.spacedReviewDecision
    const atMs = trace?.completedAtMs ?? row.timeStamp * 1000
    const independent =
      trace?.version === 1 &&
      trace.kind === 'main' &&
      trace.outcome === 'completed' &&
      Array.isArray(trace.attempts) &&
      trace.attempts.length > 0 &&
      trace.attempts.every(
        (a) =>
          a.answerRevealed === false &&
          ['correct', 'error'].includes(a.outcome) &&
          Array.isArray(a.keys) &&
          a.keys.length > 0 &&
          a.keys.every((k) => k.visibility === 'hidden' && k.targetVisible === false),
      )
    const rating = decision?.rating && ratings[decision.rating]
    const observedFailure = independent && trace.attempts.some((a) => a.outcome === 'error' && a.error?.isSlip !== true)
    const supported =
      independent &&
      decision?.algorithm === 'fsrs-6-ts-fsrs-5.4.2' &&
      rating &&
      (rating === 1) === observedFailure &&
      changingReasons.includes(decision.reason) &&
      Number.isFinite(atMs)
    let chain = chains.get(key)
    if (
      supported &&
      ['new', 'failure'].includes(decision.reason) &&
      decision.fsrsCardBefore?.reps === 0 &&
      decision.fsrsCardBefore.state === 0 &&
      (decision.fsrsCardBefore.lastReviewMs === undefined || decision.fsrsCardBefore.lastReviewMs === 0) &&
      !chain
    ) {
      chain = { id: chains.size + 1, lastMs: atMs, reviews: [{ rating, delta_t: 0 }], valid: true }
      chains.set(key, chain)
      continue
    }
    if (!chain) {
      chains.set(key, { id: chains.size + 1, lastMs: atMs, reviews: [], valid: false })
      excluded++
      continue
    }
    if (
      !supported ||
      !chain.valid ||
      atMs <= chain.lastMs ||
      decision.fsrsCardBefore?.lastReviewMs !== chain.lastMs ||
      chain.reviews.length >= 256
    ) {
      chain.valid = false
      excluded++
      continue
    }
    // ts-fsrs dateDiffInDays uses UTC calendar boundaries, not whole 24-hour gaps.
    const delta = Math.floor(atMs / 86400000) - Math.floor(chain.lastMs / 86400000)
    chain.reviews.push({ rating, delta_t: delta })
    chain.lastMs = atMs
    if (delta > 0) items.push({ cardId: chain.id, atMs, reviews: chain.reviews.map((r) => ({ ...r })) })
  }
  return { items, excluded, wordCount: new Set(items.map((i) => i.cardId)).size }
}

export function splitFsrsOptimizationDataset(items: FsrsOptimizationItem[]) {
  const sorted = [...items].sort((a, b) => a.atMs - b.atMs)
  const cutoffMs = sorted[Math.floor(sorted.length * 0.8)]?.atMs ?? Infinity
  const train = sorted.filter((i) => i.atMs < cutoffMs)
  const validation = sorted.filter((i) => i.atMs >= cutoffMs)
  const diverse = (rows: FsrsOptimizationItem[]) =>
    rows.some((i) => i.reviews[i.reviews.length - 1].rating === 1) && rows.some((i) => i.reviews[i.reviews.length - 1].rating > 1)
  if (train.length < 64 || validation.length < 20 || !diverse(train) || !diverse(validation))
    throw new Error(
      `有效样本不足：共 ${items.length} 次跨日复习。需要至少 64 次训练、20 次验证，且两组均有拼对和拼错记录。请继续积累完整、无提示的复习历史。`,
    )
  return { train, validation, cutoffMs }
}
