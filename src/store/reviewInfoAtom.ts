import { isDataRestoring } from '@/utils/db/maintenance'
import type { ReviewRecord } from '@/utils/db/record'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

type TReviewInfoAtomData = {
  isReviewMode: boolean
  reviewRecord: ReviewRecord | undefined
}

export function reviewInfoAtom(initialValue: TReviewInfoAtomData) {
  const storageAtom = atomWithStorage('reviewModeInfo', initialValue)

  return atom(
    (get) => {
      return get(storageAtom)
    },
    (get, set, updater: TReviewInfoAtomData | ((oldValue: TReviewInfoAtomData) => TReviewInfoAtomData)) => {
      if (isDataRestoring()) return
      const newValue = typeof updater === 'function' ? updater(get(storageAtom)) : updater

      // update reviewRecord to indexdb
      if (newValue.reviewRecord?.id) {
        void putWordReviewRecord(newValue.reviewRecord).catch((error) => console.error('Failed to save review progress', error))
      }
      set(storageAtom, newValue)
    },
  )
}
