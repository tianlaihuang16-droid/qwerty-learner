import { buildPracticeActivity, getPracticeActivityRange } from './activityData'
import { isOpenDarkModeAtom } from '@/store'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import React, { useMemo } from 'react'
import ActivityCalendar from 'react-activity-calendar'
import { Tooltip as ReactTooltip } from 'react-tooltip'
import 'react-tooltip/dist/react-tooltip.css'

const monthLabels = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

export default function PracticeActivity() {
  const isOpenDarkMode = useAtomValue(isOpenDarkModeAtom)
  const mountedAt = useMemo(() => new Date(), [])
  const emptyActivity = useMemo(() => buildPracticeActivity([], 0, mountedAt), [mountedAt])
  const activity = useLiveQuery(
    async () => {
      const range = getPracticeActivityRange(new Date())
      const [records, total] = await Promise.all([
        db.wordRecords.where('timeStamp').between(range.startTimeStamp, range.endTimeStamp, true, true).toArray(),
        db.wordRecords.count(),
      ])
      return buildPracticeActivity(records, total, new Date())
    },
    [],
    emptyActivity,
  )

  const summaryItems = [
    { label: '今日', value: activity.summary.today, testId: 'practice-today' },
    { label: '近 7 天', value: activity.summary.last7Days, testId: 'practice-week' },
    { label: '累计', value: activity.summary.total, testId: 'practice-total' },
  ]

  return (
    <section
      className="my-card mt-4 flex w-4/5 max-w-5xl flex-col rounded-xl bg-white px-5 py-4 transition-colors duration-300 dark:bg-gray-800"
      data-testid="practice-activity"
      aria-labelledby="practice-activity-title"
    >
      <div className="mb-3 flex items-center justify-between gap-6">
        <div>
          <h2 id="practice-activity-title" className="text-base font-semibold text-gray-700 dark:text-gray-100">
            练习记录
          </h2>
          <p className="mt-1 text-xs text-gray-400">过去 12 个月 · 每完成一个单词记 1 次</p>
        </div>
        <dl className="flex shrink-0 gap-6 text-right">
          {summaryItems.map((item) => (
            <div key={item.label}>
              <dt className="text-xs text-gray-400">{item.label}</dt>
              <dd className="text-lg font-semibold text-indigo-500" data-testid={item.testId}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="overflow-x-auto pb-1">
        <ActivityCalendar
          data={activity.data}
          blockSize={11}
          blockMargin={3}
          blockRadius={3}
          fontSize={12}
          colorScheme={isOpenDarkMode ? 'dark' : 'light'}
          hideColorLegend
          hideTotalCount
          labels={{
            months: monthLabels,
            weekdays: ['日', '一', '二', '三', '四', '五', '六'],
            totalCount: '{{count}}',
            legend: { less: '少', more: '多' },
          }}
          theme={{
            light: ['#eef2f7', '#c7d2fe', '#818cf8', '#4f46e5', '#312e81'],
            dark: ['#1f2937', '#4338ca', '#6366f1', '#a5b4fc', '#e0e7ff'],
          }}
          renderBlock={(block, day) =>
            React.cloneElement(block as React.ReactElement<Record<string, unknown>>, {
              'data-practice-date': day.date,
              'data-tooltip-id': 'practice-activity-tooltip',
              'data-tooltip-html': `${day.date}<br />完成 ${day.count} 个单词`,
            })
          }
        />
      </div>
      <ReactTooltip id="practice-activity-tooltip" place="top" />
    </section>
  )
}
