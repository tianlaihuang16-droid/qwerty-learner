import type { DictionaryLearningProgress } from '@/utils/dictionaryLearning'
import { EBBINGHAUS_INTERVAL_MINUTES } from '@/utils/db/spaced-repetition'

type Props = {
  progress: DictionaryLearningProgress
  variant: 'card' | 'detail'
}

const stageColors = [
  'bg-indigo-300',
  'bg-indigo-400',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-fuchsia-500',
  'bg-teal-400',
  'bg-teal-500',
  'bg-emerald-500',
  'bg-emerald-600',
]

function intervalLabel(minutes: number) {
  if (minutes < 60) return `${minutes}分钟`
  if (minutes < 24 * 60) return `${minutes / 60}小时`
  return `${minutes / (24 * 60)}天`
}

export default function DictionaryProgress({ progress, variant }: Props) {
  const stages = EBBINGHAUS_INTERVAL_MINUTES.map((minutes, index) => ({
    label: intervalLabel(minutes),
    count: progress.stages[index] ?? 0,
    color: stageColors[index],
    index,
  }))
  const label = [`未学习 ${progress.unlearned}`, ...stages.map((stage) => `${stage.label} ${stage.count}`), `已到期 ${progress.due}`].join('，')
  const isEmpty = progress.total === 0
  const percentage = (count: number) => (progress.total === 0 ? '0.0' : ((count / progress.total) * 100).toFixed(1))

  return (
    <div className={variant === 'detail' ? 'w-full' : 'w-full pr-20'} data-testid="dictionary-progress" aria-label={label}>
      <div
        className={`flex w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600 ${variant === 'detail' ? 'h-3' : 'h-2'}`}
      >
        {isEmpty ? (
          <div className="h-full w-full bg-slate-200 dark:bg-slate-600" aria-hidden="true" />
        ) : (
          <>
            {progress.unlearned > 0 && (
              <div
                className="h-full min-w-0 bg-slate-200 dark:bg-slate-600"
                style={{ flexGrow: progress.unlearned, flexBasis: 0 }}
                data-status="unlearned"
                data-count={progress.unlearned}
                aria-hidden="true"
              />
            )}
            {stages.map(({ index, color, count }) =>
              count > 0 ? (
                <div
                  key={index}
                  className={`h-full min-w-0 ${color}`}
                  style={{ flexGrow: count, flexBasis: 0 }}
                  data-stage={index}
                  data-count={count}
                  aria-hidden="true"
                />
              ) : null,
            )}
          </>
        )}
      </div>
      {variant === 'detail' && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-4 lg:grid-cols-6">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-200 dark:bg-slate-600" aria-hidden="true" />
              未学习 {progress.unlearned} · {percentage(progress.unlearned)}%
            </span>
            {stages.map(({ index, label: stageLabel, count, color }) => (
              <span key={index} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className={`h-2.5 w-2.5 rounded-sm ${color}`} aria-hidden="true" />
                {stageLabel} {count} · {percentage(count)}%
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm font-medium text-orange-600 dark:text-orange-400">
            已到期 {progress.due} · {percentage(progress.due)}%
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">按 FSRS 当前安排的间隔分档统计；已到期的词仍计入所属档位。旧计划在首次 FSRS 复习前保留原到期时间。</p>
        </>
      )}
    </div>
  )
}
