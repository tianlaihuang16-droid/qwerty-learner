import type { TErrorWordData } from '../hooks/useErrorWords'
import { Button } from '@/components/ui/button'
import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { timeStamp2String } from '@/utils'
import { generateNewWordReviewRecord, useGetLatestReviewRecord } from '@/utils/db/review-record'
import { generateSpacedReviewRecord, getSpacedReviewSummary } from '@/utils/db/spaced-review-service'
import * as Progress from '@radix-ui/react-progress'
import { useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MdiRobotAngry from '~icons/mdi/robot-angry'

export function ReviewDetail({ errorData, dict }: { errorData: TErrorWordData[]; dict: Dictionary }) {
  const latestReviewRecord = useGetLatestReviewRecord(dict.id)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const navigate = useNavigate()
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const [spacedSummary, setSpacedSummary] = useState({ dueCount: 0, gptAdjustedCount: 0, nextReviewAt: undefined as number | undefined })
  const [reviewMessage, setReviewMessage] = useState('')

  useEffect(() => {
    getSpacedReviewSummary(dict.id)
      .then(setSpacedSummary)
      .catch((error) => console.error('Failed to load review summary', error))
  }, [dict.id])

  const startReview = async () => {
    const record = await generateNewWordReviewRecord(dict.id, errorData)
    if (!record) {
      setReviewMessage('错词已全部拉黑，暂无可新建的复习')
      return
    }
    setReviewMessage('')
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)
    setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
    navigate('/')
  }

  const continueReview = () => {
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)

    setReviewModeInfo({ isReviewMode: true, reviewRecord: latestReviewRecord })
    navigate('/')
  }

  const startSpacedReview = async () => {
    const record = await generateSpacedReviewRecord(dict.id)
    if (!record) return
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)
    setReviewModeInfo({ isReviewMode: true, reviewRecord: record })
    navigate('/')
  }

  return (
    <div className="flex h-full flex-col items-center justify-around px-60">
      <div>
        <MdiRobotAngry fontSize={30} className="text-indigo-300 " />
        <blockquote>
          <p className="text-lg font-medium text-gray-600 dark:text-gray-300">
            FSRS-6 根据独立听写的拼写结果安排复习；首键等待和明显停顿可区分 Hard 与 Easy
            <br />
            网页版的复习记录保存在当前浏览器中，请定期导出备份
          </p>
        </blockquote>
      </div>
      <div className="flex w-full flex-col items-center">
        {latestReviewRecord && (
          <>
            <div className=" ml-10 flex w-full items-center py-0">
              <Progress.Root
                value={latestReviewRecord.index + 1}
                max={latestReviewRecord.words.length}
                className="mr-4 h-2 w-full rounded-full border  border-indigo-400 bg-white"
              >
                <Progress.Indicator
                  className="h-full rounded-full bg-indigo-400 pl-0"
                  style={{ width: `calc(${((latestReviewRecord.index + 1) / latestReviewRecord.words.length) * 100}% )` }}
                />
              </Progress.Root>
              <span className="p-0 text-xs">
                {latestReviewRecord.index + 1}/{latestReviewRecord.words.length}
              </span>
            </div>
            <div className="mt-1 text-sm font-normal text-gray-500">{`( 创建于 ${timeStamp2String(latestReviewRecord.createTime)} )`}</div>
          </>
        )}

        <div className="mt-4 text-center text-gray-600 dark:text-gray-300">
          <div>今日到期：{spacedSummary.dueCount} 个单词</div>
          <div className="mt-1 text-sm text-gray-500">
            GPT 已调整：{spacedSummary.gptAdjustedCount} 个
            {spacedSummary.dueCount === 0 && spacedSummary.nextReviewAt
              ? ` · 下次复习 ${new Date(spacedSummary.nextReviewAt * 1000).toLocaleString()}`
              : ''}
          </div>
        </div>

        {!latestReviewRecord && <div className="mt-3">历史错词数：{errorData.length}</div>}

        <div className="mt-6 flex gap-10">
          {latestReviewRecord && (
            <Button size="sm" onClick={continueReview}>
              继续当前进度
            </Button>
          )}
          <Button size="sm" onClick={startSpacedReview} disabled={spacedSummary.dueCount === 0}>
            {dict.reviewScope === 'dictionary' ? '继续本辞书 FSRS 复习' : '开始今日复习（每组最多 30 词）'}
          </Button>
          <Button size="sm" variant="outline" onClick={startReview} disabled={errorData.length === 0}>
            {latestReviewRecord ? '新建全部错词复习' : '全部错词复习'}
          </Button>
        </div>
        {reviewMessage && (
          <p role="status" className="mt-3 text-sm text-gray-500">
            {reviewMessage}
          </p>
        )}
      </div>
    </div>
  )
}
