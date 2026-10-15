import { db } from '@/utils/db'
import { buildDailyCleanRates } from '@/utils/dailyCleanRate'
import { useLiveQuery } from 'dexie-react-hooks'
import { Tooltip } from 'react-tooltip'

export default function DailyCleanRateChart() {
  const days = useLiveQuery(async () => {
    const start = new Date()
    start.setFullYear(start.getFullYear() - 1)
    start.setHours(0, 0, 0, 0)
    const records = await db.wordRecords.where('timeStamp').aboveOrEqual(start.getTime() / 1000).toArray()
    return buildDailyCleanRates(records)
  }, [])
  const eligible = days?.reduce((sum, day) => sum + day.eligible, 0) ?? 0
  const correct = days?.reduce((sum, day) => sum + day.correct, 0) ?? 0
  const excluded = days?.reduce((sum, day) => sum + day.excluded, 0) ?? 0

  return (
    <section className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700" data-testid="daily-clean-rate">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">每日首次无提示拼对率</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">最近 14 个练习日 · 全部词书</span>
      </div>
      {days === undefined ? <p className="py-6 text-sm text-slate-400">正在读取拼写记录…</p> : !days.length ? (
        <p className="py-6 text-sm text-slate-400">暂无练习记录</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="flex h-48 min-w-max gap-2 pb-1 pt-5">
            <div className="flex h-36 flex-col justify-between pr-1 text-[10px] text-slate-400" aria-hidden="true">
              <span>100%</span><span>50%</span><span>0%</span>
            </div>
            {days.map((day) => {
              const detail = `${day.date}：${day.rate === null ? '暂无有效样本' : `${day.rate}%`}；首次无提示拼对 ${day.correct} / ${day.eligible} 次；排除 ${day.excluded} 次`
              return (
                <div key={day.date} className="flex min-w-[38px] flex-1 flex-col items-center" tabIndex={0}
                  aria-label={detail} data-tooltip-id="daily-clean-rate-tooltip" data-tooltip-content={detail}>
                  <div className="relative flex h-36 w-full items-end justify-center border-b border-slate-200 bg-[linear-gradient(to_top,transparent_49%,rgba(148,163,184,0.15)_50%,transparent_51%)] dark:border-slate-600">
                    <div className="relative w-7 rounded-t-lg bg-pink-400 dark:bg-pink-300"
                      style={{ height: day.rate === null ? 0 : `${day.rate}%` }}>
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-300">
                        {day.rate === null ? '—' : day.rate}
                      </span>
                    </div>
                  </div>
                  <span className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">{day.date.slice(5).replace('-', '/')}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        首次拼对 {correct} / 有效作答 {eligible} 次 · 排除 {excluded} 次。按完成日期统计；每次出现取首次作答，输入时答案须全程隐藏。
        看过答案、当轮复练、中断及缺少证据的旧记录不计入分母；无有效样本显示“—”。
      </p>
      <Tooltip id="daily-clean-rate-tooltip" place="top" />
    </section>
  )
}
