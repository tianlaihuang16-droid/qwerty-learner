import Tooltip from '@/components/Tooltip'
import { currentDictInfoAtom, isReviewModeAtom, reviewModeInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { NavLink } from 'react-router-dom'

export const DictChapterButton = () => {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const isAllSpacedReview = reviewModeInfo.reviewRecord?.dict === 'spaced-review-today'
  return (
    <Tooltip content="词典切换">
      <NavLink
        className="block rounded-lg px-3 py-1 text-lg text-indigo-500 transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
        to="/gallery"
      >
        {isReviewMode && reviewModeInfo.reviewRecord?.gptTraining
          ? `GPT 今日训练 · ${reviewModeInfo.reviewRecord.gptTraining.task.title}`
          : isReviewMode && isAllSpacedReview
          ? 'FSRS 今日复习'
          : `${currentDictInfo.name} ${
              isReviewMode ? (reviewModeInfo.reviewRecord?.mode === 'spaced' ? 'FSRS 复习' : '错题复习') : ''
            }`}
      </NavLink>
    </Tooltip>
  )
}
