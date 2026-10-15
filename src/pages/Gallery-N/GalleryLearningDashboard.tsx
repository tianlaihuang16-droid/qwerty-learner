import DailyCleanRateChart from './DailyCleanRateChart'
import DictionaryProgress from './DictionaryProgress'
import { useDictionaryLearningProgress } from './hooks/useDictionaryLearningProgress'
import type { GalleryLearningResult } from './hooks/useGalleryLearningSnapshot'
import PracticeActivity from '@/pages/Typing/components/PracticeActivity'
import { idDictionaryMap } from '@/resources/dictionary'
import { currentChapterAtom, currentDictIdAtom, lastLearningDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { generateAllSpacedReviewRecord } from '@/utils/db/spaced-review-service'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function GalleryLearningDashboard({ dictionary, learning }: { dictionary: Dictionary; learning: GalleryLearningResult }) {
  const result = useDictionaryLearningProgress(dictionary)
  const { snapshot: globalSnapshot, error: globalError } = learning
  const [reviewStarting, setReviewStarting] = useState(false)
  const [reviewError, setReviewError] = useState(false)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const lastLearningDictId = useAtomValue(lastLearningDictIdAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const progress = result.status === 'ready' ? result.progress : undefined
  const globalProgress = globalSnapshot?.progress
  const learned = progress ? progress.total - progress.unlearned : 0
  const learnedPercent = progress && progress.total > 0 ? Math.round((learned / progress.total) * 100) : 0
  const metrics = globalProgress
    ? [
        { label: '未学习', count: globalProgress.unlearned, color: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200' },
        { label: '学习中', count: globalProgress.learning, color: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200' },
        { label: '待复习', count: globalProgress.due, color: 'bg-orange-50 text-orange-800 dark:bg-stone-800 dark:text-orange-200' },
        { label: '已掌握', count: globalProgress.mastered, color: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200' },
      ]
    : []

  const startLearning = () => {
    if (idDictionaryMap[lastLearningDictId]) setCurrentDictId(lastLearningDictId)
    setCurrentChapter(0)
    setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
    navigate('/')
  }

  const startReview = async () => {
    if (!globalProgress?.due || reviewStarting) return
    setReviewStarting(true)
    setReviewError(false)
    try {
      const record = await generateAllSpacedReviewRecord()
      if (!record) {
        setReviewError(true)
        return
      }
      const firstSourceDict = record.words[0]?.sourceDict
      if (firstSourceDict) setCurrentDictId(firstSourceDict)
      setCurrentChapter(-1)
      setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
      navigate('/')
    } catch (error) {
      console.error('Failed to start global FSRS review', error)
      setReviewError(true)
    } finally {
      setReviewStarting(false)
    }
  }

  return (
    <section
      className="w-full overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-[0_18px_60px_-35px_rgba(79,70,229,0.55)] dark:border-slate-700 dark:bg-slate-900"
      data-testid="gallery-learning-dashboard"
      aria-label={`${dictionary.name} 学习总览`}
    >
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-indigo-100">当前学习词书</p>
            <h2 className="mt-1 break-words text-xl font-semibold leading-tight">{dictionary.name}</h2>
            <p className="mt-1 text-xs text-indigo-100">{progress?.total ?? dictionary.length} 词 · FSRS 学习总览</p>
          </div>
          {progress ? (
            <div className="flex shrink-0 items-center gap-3">
              <div
                className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20"
                style={{ background: `conic-gradient(#a76348 ${learnedPercent}%, #ded6c9 ${learnedPercent}%)` }}
                role="img"
                aria-label={`已学习 ${learnedPercent}%`}
              >
                <div className="flex h-12 w-12 flex-col items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800">
                  <span className="text-base font-bold">{learnedPercent}%</span>
                  <span className="text-[9px] text-indigo-100">已学习</span>
                </div>
              </div>
              <div className="min-w-0 text-xs text-indigo-100">
                <p className="text-lg font-semibold text-white">
                  {learned} / {progress.total}
                </p>
                <p>词条已有学习状态</p>
              </div>
            </div>
          ) : (
            <div className="bg-white/15 rounded-xl px-3 py-2 text-sm text-white" role="status">
              {result.status === 'error' ? '学习进度暂不可用' : '正在读取学习进度…'}
            </div>
          )}
        </div>
        <div className="gallery-dashboard-content min-w-0 p-4">
          <button type="button" className="my-btn-primary mb-4 w-fit rounded-lg px-4 py-2.5 text-sm" onClick={startLearning}>
            继续学习新词 →
          </button>
          <PracticeActivity />
          <DailyCleanRateChart />
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">全局学习状态与复习节奏</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">全部普通词书去重统计，不含独立复习词书和拉黑词</p>
          </div>
          {globalProgress && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {metrics.map(({ label, count, color }) =>
                  label === '未学习' || label === '学习中' || label === '待复习' ? (
                    <button
                      key={label}
                      type="button"
                      onClick={label === '待复习' ? startReview : startLearning}
                      disabled={count === 0 || (label === '待复习' && reviewStarting)}
                      className={`rounded-lg px-3 py-2 text-left transition hover:brightness-95 disabled:cursor-default disabled:hover:brightness-100 ${color}`}
                    >
                      <p className="text-xs opacity-75">{label}</p>
                      <p className="text-lg font-bold tabular-nums">{count}</p>
                    </button>
                  ) : (
                    <div key={label} className={`rounded-lg px-3 py-2 ${color}`}>
                      <p className="text-xs opacity-75">{label}</p>
                      <p className="text-lg font-bold tabular-nums">{count}</p>
                    </div>
                  ),
                )}
              </div>
              {reviewError && <p className="mt-2 text-xs text-amber-600">复习词书生成失败，请重试。</p>}
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="tomorrow-review-forecast">
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 dark:border-indigo-900 dark:bg-indigo-950/40">
                  <p className="text-xs text-indigo-700 dark:text-indigo-200">明日到期</p>
                  <p className="text-lg font-bold tabular-nums text-indigo-950 dark:text-white">
                    {globalSnapshot ? `${globalSnapshot.forecast.count} 词` : globalError ? '暂不可用' : '计算中…'}
                  </p>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-300">按本地日期和实际复习队列统计</p>
                </div>
                <div className="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 dark:border-teal-900 dark:bg-teal-950/40">
                  <p className="text-xs text-teal-700 dark:text-teal-200">
                    预计用时{globalSnapshot ? ` · 当前待复习 ${globalSnapshot.currentReviewEstimate.count} 词` : ''}
                  </p>
                  <p className="text-lg font-bold tabular-nums text-teal-950 dark:text-white">
                    {globalSnapshot
                      ? globalSnapshot.currentReviewEstimate.estimatedMinutes === null
                        ? '暂无估计'
                        : globalSnapshot.currentReviewEstimate.estimatedMinutes === globalSnapshot.currentReviewEstimate.upperMinutes
                        ? `约 ${globalSnapshot.currentReviewEstimate.estimatedMinutes} 分钟`
                        : `约 ${globalSnapshot.currentReviewEstimate.estimatedMinutes}–${globalSnapshot.currentReviewEstimate.upperMinutes} 分钟`
                      : globalError
                      ? '暂不可用'
                      : '计算中…'}
                  </p>
                  <p className="text-[11px] text-teal-700 dark:text-teal-300">
                    {globalSnapshot?.currentReviewEstimate.sampleCount
                      ? `按近 ${globalSnapshot.currentReviewEstimate.sampleCount} 个词的整轮耗时估算，含读音和错词复练；同词记录覆盖 ${globalSnapshot.currentReviewEstimate.matchedWordCount}/${globalSnapshot.currentReviewEstimate.count} 词，不含额外休息`
                      : '缺少含读音的完整复习记录时不估计'}
                  </p>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                <h4 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">FSRS 复习间隔分布</h4>
                <DictionaryProgress progress={globalProgress} variant="detail" />
              </div>
            </>
          )}
          {globalError && <p className="mt-5 text-sm text-amber-600">全局词书或学习状态读取失败，请稍后重试。</p>}
        </div>
      </div>
    </section>
  )
}
