import { getTodayReviewProgress } from '@/utils/db/spaced-review-service'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'

export default function TodayReviewProgress() {
  const [revision, setRevision] = useState(0)
  const result = useLiveQuery(async () => {
    try { return { progress: await getTodayReviewProgress(), error: false } }
    catch (error) { console.error('Failed to read today review progress', error); return { progress: undefined, error: true } }
  }, [revision])
  const progress = result?.progress
  useEffect(() => {
    if (!progress) return
    const timer = setTimeout(() => setRevision(value => value + 1), Math.max(0, progress.nextRefreshAt - Date.now()))
    return () => clearTimeout(timer)
  }, [progress])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision(value => value + 1) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])
  const percentage = progress?.percentage ?? 0
  const circumference = 2 * Math.PI * 20
  return (
    <div data-testid="today-review-progress" className="flex min-w-0 flex-col items-center justify-center"
      title="全局普通词书：今日到期复习与当前待复习词去重统计；复习后再次到期仍算待完成，不含新词、当轮复练或独立词书。">
      <div className="relative h-14 w-14" role="progressbar" aria-label="今日复习进度" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress ? Math.round(percentage) : undefined} aria-valuetext={progress ? `${progress.completed}/${progress.total} 词完成` : result?.error ? '暂不可用' : '计算中'}>
        <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="24" cy="24" r="20" fill="none" strokeWidth="4" className="stroke-gray-200 dark:stroke-gray-700" />
          <circle cx="24" cy="24" r="20" fill="none" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percentage / 100)} className="stroke-indigo-500" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums text-gray-600 dark:text-gray-300">
          {progress ? `${Math.round(percentage)}%` : '—'}
        </span>
      </div>
      {progress && <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{progress.completed}/{progress.total} 词</span>}
      <span className="pt-1 text-xs text-gray-600 dark:text-gray-300">{result?.error ? '暂不可用' : '今日复习进度'}</span>
    </div>
  )
}
