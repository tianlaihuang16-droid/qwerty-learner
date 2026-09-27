import { CHAPTER_LENGTH } from '@/constants'

export function calcChapterCount(length: number) {
  return Math.ceil(length / CHAPTER_LENGTH)
}
