import { db } from '.'
import { runStudyWrite } from './maintenance'
import { ReviewRecord } from './record'
import { wordFeedbackMap } from './word-feedback'
import { serializedWordLearningKey, wordLearningIdentity } from './word-learning-identity'
import type { TErrorWordData } from '@/pages/Gallery-N/hooks/useErrorWords'
import type { Word } from '@/typings'
import { useEffect, useState } from 'react'

export function useGetLatestReviewRecord(dictID: string) {
  const [wordReviewRecord, setWordReviewRecord] = useState<ReviewRecord | undefined>(undefined)
  useEffect(() => {
    const fetchWordReviewRecords = async () => {
      const record = await getReviewRecords(dictID)
      setWordReviewRecord(record)
    }
    if (dictID) {
      fetchWordReviewRecords()
    }
  }, [dictID])
  return wordReviewRecord
}

async function getReviewRecords(dictID: string): Promise<ReviewRecord | undefined> {
  const records = await db.reviewRecords.where('dict').equals(dictID).toArray()

  const latestRecord = records.sort((a, b) => a.createTime - b.createTime).pop()

  return latestRecord && (latestRecord.isFinished ? undefined : latestRecord)
}

type TRankedErrorWordData = TErrorWordData & {
  errorCountScore: number
  latestErrorTimeScore: number
}

export async function generateNewWordReviewRecord(dictID: string, errorData: TErrorWordData[]): Promise<ReviewRecord | undefined> {
  const feedback = wordFeedbackMap(await db.wordFeedback.toArray())
  const availableErrors = errorData.filter((item) => {
    const key = serializedWordLearningKey(wordLearningIdentity(dictID, item.originData.name))
    return !feedback.get(key)?.blacklisted
  })
  if (!availableErrors.length) return undefined

  const errorCountRankings = [...availableErrors].sort((a, b) => a.errorCount - b.errorCount)
  const latestErrorTimeRankings = [...availableErrors].sort((a, b) => a.latestErrorTime - b.latestErrorTime)

  // 计算每个对象的排名得分
  const errorDataWithRank: TRankedErrorWordData[] = availableErrors.map((item) => ({
    ...item,
    errorCountScore: errorCountRankings.indexOf(item) + 1,
    latestErrorTimeScore: latestErrorTimeRankings.indexOf(item) + 1,
  }))

  // 根据加权排名进行排序
  const errorCountWeight = 0.6
  const latestErrorTimeWeight = 0.4

  const sortedWords: Word[] = errorDataWithRank
    .sort((a, b) => {
      // 计算 a 和 b 的得分
      const scoreA = a.errorCountScore * errorCountWeight + a.latestErrorTimeScore * latestErrorTimeWeight
      const scoreB = b.errorCountScore * errorCountWeight + b.latestErrorTimeScore * latestErrorTimeWeight

      // 根据得分进行排序
      return scoreA - scoreB
    })
    .map((item) => item.originData)

  const record = new ReviewRecord(dictID, sortedWords)
  record.id = await runStudyWrite(() => db.reviewRecords.add(record))
  return record
}

export async function putWordReviewRecord(record: ReviewRecord) {
  return runStudyWrite(() => db.reviewRecords.put(record))
}
