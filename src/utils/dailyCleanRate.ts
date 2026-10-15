import type { IWordRecord } from './db/record'

export type DailyCleanRate = { date: string; correct: number; eligible: number; excluded: number; rate: number | null }

// Each main exposure contributes its first attempt, not its eventual corrected answer.
export function buildDailyCleanRates(records: Pick<IWordRecord, 'timeStamp' | 'spelling'>[], limit = 14): DailyCleanRate[] {
  const days = new Map<string, DailyCleanRate>()
  for (const record of records) {
    const at = new Date(record.timeStamp * 1000)
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
    const day = days.get(date) ?? { date, correct: 0, eligible: 0, excluded: 0, rate: null }
    days.set(date, day)
    const trace = record.spelling
    const first = trace?.attempts[0]
    if (!trace || trace.kind !== 'main' || trace.outcome !== 'completed' || !first || first.number !== 1
      || (first.outcome !== 'correct' && first.outcome !== 'error') || first.answerRevealed !== false
      || !first.keys.length || !first.keys.every((key) => key.visibility === 'hidden' && key.targetVisible === false)) {
      day.excluded++
      continue
    }
    day.eligible++
    if (first.outcome === 'correct') day.correct++
  }
  return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
    .map((day) => ({ ...day, rate: day.eligible ? Math.round(day.correct / day.eligible * 1000) / 10 : null }))
}
