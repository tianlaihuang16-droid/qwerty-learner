import { EXPLICIT_SPACE } from '@/constants'

export function wordSegmentBoundaries(displayWord: string, segments?: string[]): number[] {
  if (!segments || segments.length < 2) return []
  const parts = segments.map(part => part.replaceAll(' ', EXPLICIT_SPACE).replaceAll('…', '..'))
  if (parts.some(part => part.length === 0) || parts.join('') !== displayWord) return []
  let position = 0
  return parts.slice(0, -1).map(part => (position += part.length))
}

export function segmentationExplanationUrl(word: string, segments: string[]): string {
  const prompt = `请用中文解释英语单词 ${JSON.stringify(word)} 的切分 ${JSON.stringify(segments)}。请先判断这是词根词缀切分还是音节切分，以及切分是否合理；不要为了迎合给定切分而编造词源。逐段说明含义或发音作用、组合成整个词的原理和记忆方法。若有不合理之处，请明确纠正并给出更合适的切分。`
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
}
