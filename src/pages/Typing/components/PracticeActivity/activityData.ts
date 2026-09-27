import type { Activity } from 'react-activity-calendar'

type TimestampedRecord = {
  timeStamp: number
}

export type PracticeActivitySummary = {
  today: number
  last7Days: number
  total: number
}

const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const formatLocalDate = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const getLevel = (count: number, activeCounts: number[]): Activity['level'] => {
  if (count === 0) return 0
  if (activeCounts[activeCounts.length - 1] <= 12) {
    if (count < 4) return 1
    if (count < 8) return 2
    if (count < 12) return 3
    return 4
  }
  if (activeCounts.length === 1) return 4
  const levels: Activity['level'][] = [1, 2, 3, 4]
  return levels[Math.round((activeCounts.indexOf(count) * 3) / (activeCounts.length - 1))]
}

export function getPracticeActivityRange(now = new Date()) {
  const end = startOfLocalDay(now)
  end.setHours(23, 59, 59, 999)
  const start = startOfLocalDay(now)
  start.setFullYear(start.getFullYear() - 1)
  start.setDate(start.getDate() + 1)

  return {
    startTimeStamp: Math.floor(start.getTime() / 1000),
    endTimeStamp: Math.floor(end.getTime() / 1000),
  }
}

export function buildPracticeActivity(records: TimestampedRecord[], total: number, now = new Date()) {
  const { startTimeStamp, endTimeStamp } = getPracticeActivityRange(now)
  const start = new Date(startTimeStamp * 1000)
  const end = startOfLocalDay(new Date(endTimeStamp * 1000))
  const counts = new Map<string, number>()

  for (const record of records) {
    if (record.timeStamp < startTimeStamp || record.timeStamp > endTimeStamp) continue
    const key = formatLocalDate(new Date(record.timeStamp * 1000))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const activeCounts = Array.from(new Set(counts.values())).sort((left, right) => left - right)

  const data: Activity[] = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatLocalDate(cursor)
    const count = counts.get(date) ?? 0
    data.push({ date, count, level: getLevel(count, activeCounts) })
  }

  const today = data.at(-1)?.count ?? 0
  const last7Days = data.slice(-7).reduce((sum, day) => sum + day.count, 0)

  return {
    data,
    summary: { today, last7Days, total } satisfies PracticeActivitySummary,
  }
}
