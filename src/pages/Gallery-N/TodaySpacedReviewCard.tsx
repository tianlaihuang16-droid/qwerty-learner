import type { GalleryLearningResult } from './hooks/useGalleryLearningSnapshot'
import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import { generateAllSpacedReviewRecord, generateSoonDueSpacedReviewRecord } from '@/utils/db/spaced-review-service'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PajamasReviewList from '~icons/pajamas/review-list'

type Summary = {
  dueCount: number
  gptAdjustedCount: number
  nextReviewAt?: number
}

const EMPTY_SUMMARY: Summary = { dueCount: 0, gptAdjustedCount: 0 }

export default function TodaySpacedReviewCard({ learning }: { learning: GalleryLearningResult }) {
  const summary = learning.review?.summary ?? EMPTY_SUMMARY
  const soonDue = learning.review?.soonDue ?? { count: 0, nextReviewAt: undefined }
  const [isStarting, setIsStarting] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [message, setMessage] = useState('')
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const navigate = useNavigate()

  const startReview = async () => {
    if (summary.dueCount === 0 || isStarting) return
    setIsStarting(true)
    try {
      const record = await generateAllSpacedReviewRecord()
      if (!record) return
      const firstSourceDict = record.words[0]?.sourceDict
      if (firstSourceDict) setCurrentDictId(firstSourceDict)
      setCurrentChapter(-1)
      setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
      navigate('/')
    } finally {
      setIsStarting(false)
    }
  }

  const startSoonDue = async () => {
    if (isAdvancing || soonDue.count === 0) return
    setIsAdvancing(true)
    try {
      const record = await generateSoonDueSpacedReviewRecord()
      if (!record) {
        setMessage('没有可提前练习的词')
        return
      }
      const firstSourceDict = record.words[0]?.sourceDict
      if (firstSourceDict) setCurrentDictId(firstSourceDict)
      setCurrentChapter(-1)
      setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
      navigate('/')
    } catch (error) {
      console.error('Failed to start soon due reviews', error)
      setMessage('提前练习失败，请重试')
    } finally {
      setIsAdvancing(false)
    }
  }

  const nextText =
    summary.dueCount === 0 && soonDue.count > 0 && soonDue.nextReviewAt
      ? `${soonDue.count} 词将在 ${new Date(soonDue.nextReviewAt * 1000).toLocaleTimeString()} 到期`
      : summary.dueCount === 0 && summary.nextReviewAt
      ? `下次复习：${new Date(summary.nextReviewAt * 1000).toLocaleString()}`
      : summary.dueCount === 0
      ? '练习单词后会自动加入复习计划'
      : `点击开始本组，最多 30 词${summary.gptAdjustedCount ? ` · GPT 已调整 ${summary.gptAdjustedCount} 词` : ''}`

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={startReview}
        disabled={summary.dueCount === 0 || isStarting}
        className="group flex w-full cursor-pointer items-center rounded-2xl border border-stone-300 bg-stone-100 p-5 text-left text-stone-800 transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-default disabled:opacity-70 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
      >
        <div className="mr-4 rounded-xl bg-white/60 p-3 text-stone-500 dark:bg-stone-700 dark:text-stone-300">
          <PajamasReviewList className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-stone-500 dark:text-stone-400">FSRS 今日复习</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">
            {learning.reviewError ? '复习统计暂不可用' : !learning.review ? '正在读取复习统计…' : `今日到期 ${summary.dueCount} 词`}
          </div>
          <div className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            {isStarting ? '正在生成复习词书…' : nextText}
          </div>
        </div>
      </button>
      {summary.dueCount === 0 && soonDue.count > 0 && (
        <button
          type="button"
          onClick={startSoonDue}
          disabled={isAdvancing}
          className="mt-2 w-full cursor-pointer rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-default disabled:opacity-60"
        >
          {isAdvancing ? '正在准备…' : `提前练习 ${soonDue.count} 个 10 分钟内到期的词`}
        </button>
      )}
      {message && <div className="mt-2 text-center text-xs text-green-600">{message}</div>}
    </div>
  )
}
