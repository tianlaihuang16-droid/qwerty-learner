import { TypingContext } from '../store'
import { db, spacedReviewDb } from '@/utils/db'
import { canManuallyRateSpelling, getFsrsMemoryMetrics } from '@/utils/db/spaced-repetition'
import { weightsForDecision } from '@/utils/db/fsrs-parameters'
import { updateLastSpacedReviewRating } from '@/utils/db/spaced-review-service'
import { spacedReviewIdentity, wordLearningStateKey } from '@/utils/db/word-learning-identity'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useContext, useEffect, useState } from 'react'

type Props = { word: string; sourceIndex: number; shortcutsEnabled: boolean; showWord?: boolean }

export default function LastWordRating({ word, sourceIndex, shortcutsEnabled, showWord = false }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const previousRecord = state.lastGradedRecord
  const snapshot = useLiveQuery(async () => {
    if (!previousRecord?.id) return undefined
    const record = await db.wordRecords.get(previousRecord.id)
    const current = record ? await spacedReviewDb.wordStates.get(wordLearningStateKey(spacedReviewIdentity(record.dict, record.word))) : undefined
    return { recordId: previousRecord.id, record, current }
  }, [previousRecord?.id])
  const ratingRecord = snapshot?.recordId === previousRecord?.id ? snapshot?.record : undefined
  const decision = ratingRecord?.spacedReviewDecision
  const isPreviousResult = Boolean(previousRecord && previousRecord.sessionId === state.spellingSession.id &&
    previousRecord.sourceIndex === sourceIndex && previousRecord.word === word && decision?.algorithm.startsWith('fsrs-6'))
  const canRatePrevious = isPreviousResult && Boolean(ratingRecord && canManuallyRateSpelling(ratingRecord))
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingError, setRatingError] = useState(false)

  const setRating = useCallback(async (rating: 'easy' | 'hard') => {
    if (!canRatePrevious || !previousRecord || ratingBusy) return
    setRatingBusy(true)
    setRatingError(false)
    try {
      if (!(await updateLastSpacedReviewRating(previousRecord.id, rating))) setRatingError(true)
    } catch (error) {
      console.error('Could not change previous word rating', error)
      setRatingError(true)
    } finally {
      setRatingBusy(false)
    }
  }, [canRatePrevious, previousRecord, ratingBusy])

  useEffect(() => {
    if (!canRatePrevious || !shortcutsEnabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      void setRating(event.key === 'ArrowLeft' ? 'easy' : 'hard')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canRatePrevious, setRating, shortcutsEnabled])

  if (!isPreviousResult || !decision) return null
  const displayedRating = decision.practiceRating ?? decision.rating
  const atMs = ratingRecord?.spelling?.completedAtMs ?? (ratingRecord?.timeStamp ?? 0) * 1000
  const beforeCard = decision.fsrsCardBefore
  const weights = weightsForDecision(decision).weights
  const before = beforeCard && beforeCard.state !== 0 ? getFsrsMemoryMetrics({ fsrsCard: beforeCard }, atMs, weights) : null
  const current = snapshot?.current
  const after = current && current.lastRecordId === previousRecord?.id ? getFsrsMemoryMetrics(current, atMs, weights) : null
  const beforeMissing = beforeCard?.state === 0 ? '新词' : '未知'
  const changes = [
    { label: '可回忆概率', before: before?.retrievability == null ? beforeMissing : `${(before.retrievability * 100).toFixed(1)}%`,
      after: after?.retrievability == null ? '未知' : `${(after.retrievability * 100).toFixed(1)}%` },
    { label: 'FSRS 难度', before: before ? before.difficulty.toFixed(1) : beforeMissing,
      after: after ? after.difficulty.toFixed(1) : '未知' },
    { label: '稳定性', before: before ? `${before.stability.toFixed(2)} 天` : beforeMissing,
      after: after ? `${after.stability.toFixed(2)} 天` : '未知' },
  ]
  return (
    <div className="practice-rating flex flex-col gap-2 text-xs" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
      {showWord && <span className="mr-2 text-gray-600 dark:text-gray-300">上一词：{word}</span>}
      {(['easy', 'hard'] as const).map((rating) => (
        <button key={rating} type="button" disabled={!canRatePrevious || ratingBusy} onClick={() => void setRating(rating)}
          aria-pressed={displayedRating === rating}
          className={`rounded border px-2 py-1 disabled:cursor-not-allowed ${displayedRating === rating
            ? 'border-indigo-500 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100'
            : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
          {rating === 'easy' ? '← Easy' : '→ Hard'}
          {displayedRating === rating ? ` · ${decision.practiceRating || decision.ratingSource === 'manual' ? '手动' : '自动'}` : ''}
        </button>
      ))}
      {(displayedRating === 'good' || displayedRating === 'again') &&
        <span className="text-gray-500">{decision.ratingSource === 'manual' ? '手动' : '自动'} {decision.rating === 'good' ? 'Good' : 'Again'}</span>}
      {ratingError && <span role="alert" className="text-red-600">评分未保存</span>}
      {decision.practiceRating && <span className="text-gray-500">仅难易反馈，排程不变</span>}
      </div>
      <div data-testid="last-word-fsrs-changes" className="space-y-1 text-gray-600 dark:text-gray-300"
        title="按本次完成时刻比较调度前后参数；可回忆概率是 FSRS 预测值。手动改评后同步更新。">
        {changes.map((item) => <p key={item.label} className="tabular-nums">{item.label}：{item.before} → {item.after}</p>)}
      </div>
    </div>
  )
}
