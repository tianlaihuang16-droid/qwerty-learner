import { TypingContext } from '../store'
import { db } from '@/utils/db'
import { updateLastSpacedReviewRating } from '@/utils/db/spaced-review-service'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useContext, useEffect, useState } from 'react'

type Props = { word: string; sourceIndex: number; shortcutsEnabled: boolean; showWord?: boolean }

export default function LastWordRating({ word, sourceIndex, shortcutsEnabled, showWord = false }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const previousRecord = state.lastGradedRecord
  const ratingRecord = useLiveQuery(() => previousRecord?.id ? db.wordRecords.get(previousRecord.id) : undefined,
    [previousRecord?.id])
  const decision = ratingRecord?.spacedReviewDecision
  const isPreviousResult = Boolean(previousRecord && previousRecord.sessionId === state.spellingSession.id &&
    previousRecord.sourceIndex === sourceIndex && previousRecord.word === word && decision?.algorithm.startsWith('fsrs-6'))
  const canRatePrevious = isPreviousResult && Boolean(decision?.evidence === 'independent' &&
    decision.rating !== 'again' && ['new', 'independent-due'].includes(decision.reason))
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
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" onClick={(event) => event.stopPropagation()}>
      {showWord && <span className="mr-2 text-gray-600 dark:text-gray-300">上一词：{word}</span>}
      {(['easy', 'hard'] as const).map((rating) => (
        <button key={rating} type="button" disabled={!canRatePrevious || ratingBusy} onClick={() => void setRating(rating)}
          aria-pressed={decision.rating === rating}
          className={`rounded border px-2 py-1 disabled:cursor-not-allowed ${decision.rating === rating
            ? 'border-indigo-500 bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100'
            : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
          {rating === 'easy' ? '← Easy' : '→ Hard'}
          {decision.rating === rating ? ` · ${decision.ratingSource === 'manual' ? '手动' : '自动'}` : ''}
        </button>
      ))}
      {(decision.rating === 'good' || decision.rating === 'again') &&
        <span className="text-gray-500">{decision.ratingSource === 'manual' ? '手动' : '自动'} {decision.rating === 'good' ? 'Good' : 'Again'}</span>}
      {ratingError && <span role="alert" className="text-red-600">评分未保存</span>}
    </div>
  )
}
