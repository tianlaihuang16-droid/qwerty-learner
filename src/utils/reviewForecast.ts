import type { SpellingTrace } from '@/utils/spellingPractice'

export type DueReviewWord = { key: string; dueAtSeconds: number }
export type ReviewWordTiming = { key: string; seconds: number; atSeconds: number }

export type TomorrowReviewForecast = {
  count: number
  estimatedMinutes: number | null
  upperMinutes: number | null
  sampleCount: number
  matchedWordCount: number
}

// Elapsed wall time includes pronunciation. Older traces without both timestamps
// cannot be converted to that basis, and long pauses are not practice time.
export function reviewElapsedSeconds(trace: Pick<SpellingTrace, 'startedAt' | 'completedAtMs' | 'outcome'> | undefined): number | null {
  if (!trace || trace.outcome !== 'completed' || !trace.startedAt || !trace.completedAtMs) return null
  const seconds = (trace.completedAtMs - trace.startedAt * 1000) / 1000
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 180 ? seconds : null
}

function quantile(sorted: number[], fraction: number) {
  const position = (sorted.length - 1) * fraction
  const left = Math.floor(position)
  const right = Math.ceil(position)
  return sorted[left] + (sorted[right] - sorted[left]) * (position - left)
}

export function forecastTomorrowReviews(
  dueWords: readonly DueReviewWord[],
  pastWords: readonly ReviewWordTiming[],
  now = new Date(),
): TomorrowReviewForecast {
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000
  const followingStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime() / 1000
  return estimateReviewWords(dueWords.filter(({ dueAtSeconds }) =>
    Number.isFinite(dueAtSeconds) && dueAtSeconds >= tomorrowStart && dueAtSeconds < followingStart), pastWords)
}

// Estimate precisely the supplied population; calendar selection belongs to the caller.
export function estimateReviewWords(words: readonly DueReviewWord[], pastWords: readonly ReviewWordTiming[]): TomorrowReviewForecast {
  const validSamples = pastWords.filter(({ seconds }) => Number.isFinite(seconds) && seconds >= 1 && seconds <= 540)
  const sampleCount = validSamples.length
  if (words.length === 0) return { count: 0, estimatedMinutes: 0, upperMinutes: 0, sampleCount, matchedWordCount: 0 }
  if (sampleCount === 0) return { count: words.length, estimatedMinutes: null, upperMinutes: null, sampleCount: 0, matchedWordCount: 0 }

  const allSeconds = validSamples.map(({ seconds }) => seconds).sort((a, b) => a - b)
  const typical = allSeconds.reduce((sum, seconds) => sum + seconds, 0) / allSeconds.length
  const upper = Math.max(typical, quantile(allSeconds, 0.75))
  const byWord = new Map<string, ReviewWordTiming[]>()
  for (const sample of validSamples) {
    const list = byWord.get(sample.key) ?? []
    list.push(sample)
    byWord.set(sample.key, list)
  }
  let typicalSeconds = 0
  let upperSeconds = 0
  let matchedWordCount = 0
  for (const due of words) {
    const own = (byWord.get(due.key) ?? []).sort((a, b) => b.atSeconds - a.atSeconds)
      .slice(0, 3).map(({ seconds }) => seconds).sort((a, b) => a - b)
    if (own.length > 0) matchedWordCount += 1
    if (own.length >= 2) {
      const personalTypical = own.reduce((sum, seconds) => sum + seconds, 0) / own.length
      typicalSeconds += personalTypical
      upperSeconds += Math.max(quantile(own, 0.75), personalTypical * 1.25)
    } else if (own.length === 1) {
      typicalSeconds += (own[0] + typical) / 2
      upperSeconds += Math.max(own[0], upper)
    } else {
      typicalSeconds += typical
      upperSeconds += upper
    }
  }
  return {
    count: words.length,
    estimatedMinutes: Math.max(1, Math.ceil(typicalSeconds / 60)),
    upperMinutes: Math.max(1, Math.ceil(upperSeconds / 60)),
    sampleCount,
    matchedWordCount,
  }
}

// One sample is one main word plus its linked same-round correction exposures.
export function reviewRoundTimingSamples(records: readonly { key: string; atSeconds: number; trace: SpellingTrace | undefined }[]): ReviewWordTiming[] {
  const rounds = new Map<string, typeof records[number][]>()
  for (const record of records) {
    const trace = record.trace
    if (!trace?.sessionId || !Number.isInteger(trace.sourceIndex) || !['main', 'retry'].includes(trace.kind)) continue
    const roundKey = `${trace.sessionId}\u0000${trace.sourceIndex}\u0000${record.key}`
    const round = rounds.get(roundKey) ?? []
    round.push(record)
    rounds.set(roundKey, round)
  }
  return Array.from(rounds.values()).flatMap(round => {
    const mains = round.filter(record => record.trace?.kind === 'main')
    const durations = round.map(record => reviewElapsedSeconds(record.trace))
    if (mains.length !== 1 || durations.some(seconds => seconds === null)) return []
    return [{ key: mains[0].key, seconds: durations.reduce<number>((sum, seconds) => sum + (seconds as number), 0),
      atSeconds: Math.max(...round.map(record => record.atSeconds)) }]
  })
}
