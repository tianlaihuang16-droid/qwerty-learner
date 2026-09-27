import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import {
  generateAllSpacedReviewRecord,
  generateSoonDueSpacedReviewRecord,
  getAllSpacedReviewSummary,
  getSoonDueReviewSummary,
} from '@/utils/db/spaced-review-service'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PajamasReviewList from '~icons/pajamas/review-list'

type Summary = {
  dueCount: number
  gptAdjustedCount: number
  nextReviewAt?: number
}

const EMPTY_SUMMARY: Summary = { dueCount: 0, gptAdjustedCount: 0 }

export default function TodaySpacedReviewCard() {
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [soonDue, setSoonDue] = useState<{ count: number; nextReviewAt?: number }>({ count: 0 })
  const [isStarting, setIsStarting] = useState(false)
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [message, setMessage] = useState('')
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    const [next, soon] = await Promise.all([getAllSpacedReviewSummary(), getSoonDueReviewSummary()])
    setSummary(next)
    setSoonDue(soon)
  }, [])

  useEffect(() => {
    refresh().catch((error) => console.error('Failed to load all review summary', error))
  }, [refresh])

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
    <div className="mb-10 w-full min-w-0 max-w-md">
      <button
        type="button"
        onClick={startReview}
        disabled={summary.dueCount === 0 || isStarting}
        className="group flex w-full cursor-pointer items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 p-5 text-left text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-default disabled:opacity-70 disabled:hover:translate-y-0"
      >
        <div className="mr-4 rounded-xl bg-white/20 p-3">
          <PajamasReviewList className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold">FSRS 今日复习</div>
          <div className="mt-1 text-lg">今日到期 {summary.dueCount} 词</div>
          <div className="mt-1 truncate text-xs text-indigo-100">{isStarting ? '正在生成复习词书…' : nextText}</div>
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
