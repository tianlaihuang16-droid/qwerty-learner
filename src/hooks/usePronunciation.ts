import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { romajiToHiragana } from '@/utils/kana'
import { PronunciationPlayback, preparePronunciationChapter } from '@/utils/pronunciationAudio'
import type { ChapterAudioProgress } from '@/utils/pronunciationAudio'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const pronunciationApi = 'https://dict.youdao.com/dictvoice?audio='
export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>): string {
  if (!word) return ''
  const audio = encodeURIComponent(pronunciation === 'romaji' ? romajiToHiragana(word) : word)
  switch (pronunciation) {
    case 'uk':
      return `${pronunciationApi}${audio}&type=1`
    case 'us':
      return `${pronunciationApi}${audio}&type=2`
    case 'romaji':
    case 'ja':
      return `${pronunciationApi}${audio}&le=jap`
    case 'zh':
      return `${pronunciationApi}${audio}&le=zh`
    case 'de':
      return `${pronunciationApi}${audio}&le=de`
    case 'hapin':
    case 'kk':
      return `${pronunciationApi}${audio}&le=ru`
    case 'id':
      return `${pronunciationApi}${audio}&le=id`
    default:
      return ''
  }
}

export default function usePronunciationSound(word: string, isLoop?: boolean, onComplete?: () => void) {
  const config = useAtomValue(pronunciationConfigAtom)
  const [isPlaying, setIsPlaying] = useState(false)
  const url = generateWordSoundSrc(word, config.type)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const player = useMemo(() => new PronunciationPlayback(url, setIsPlaying, () => onCompleteRef.current?.()), [url])
  const loop = typeof isLoop === 'boolean' ? isLoop : config.isLoop
  useEffect(() => {
    player.configure({ volume: config.volume, rate: config.rate, loop })
  }, [player, config.volume, config.rate, loop])
  useEffect(() => () => player.stop(), [player])
  const play = useCallback(() => player.play(), [player])
  const stop = useCallback(() => player.stop(), [player])
  return { play, stop, isPlaying }
}

export function useChapterPronunciationSound(words: string[]) {
  const config = useAtomValue(pronunciationConfigAtom)
  const urls = JSON.stringify(
    Array.from(new Set(words.filter((word): word is string => !!word).map((word) => generateWordSoundSrc(word, config.type)))),
  )
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ChapterAudioProgress & { key: string }>({
    key: '',
    ready: 0,
    total: 0,
    failed: [],
    synthesized: 0,
    complete: false,
  })
  const key = `${config.isOpen}:${attempt}:${urls}`
  useEffect(() => {
    if (!config.isOpen) return
    let cancelled = false
    void preparePronunciationChapter(
      JSON.parse(urls),
      (progress) => setState({ ...progress, key }),
      () => cancelled,
    ).catch(() => {
      if (!cancelled) setState({ key, ready: 0, total: words.length, failed: JSON.parse(urls), synthesized: 0, complete: true })
    })
    return () => {
      cancelled = true
    }
  }, [key])
  const progress = state.key === key ? state : { ready: 0, total: words.length, failed: [], synthesized: 0, complete: false }
  return {
    ...progress,
    enabled: config.isOpen,
    // Caching runs in the background: the chapter may start at once and un-cached words stay silent.
    isReady: true,
    retry: () => setAttempt((value) => value + 1),
  }
}
