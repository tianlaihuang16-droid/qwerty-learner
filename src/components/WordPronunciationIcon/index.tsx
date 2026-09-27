import { SoundIcon } from './SoundIcon'
import usePronunciationSound from '@/hooks/usePronunciation'
import type { Word } from '@/typings'
import { useCallback, useEffect, useImperativeHandle } from 'react'
import React from 'react'

type WordPronunciationIconProps = {
  word: Word
  lang: string
  className?: string
  iconClassName?: string
  autoPlay?: boolean
  paused?: boolean
  onPlaybackStart?: () => void
  onPlaybackComplete?: () => void
}

export const WordPronunciationIcon = React.forwardRef<
  WordPronunciationIconRef,
  WordPronunciationIconProps
>(({ word, lang, className, iconClassName, autoPlay = false, paused = false, onPlaybackStart, onPlaybackComplete }, ref) => {
  const currentWord = () => {
    if (lang === 'hapin') {
      if (/[\u0400-\u04FF]/.test(word.notation || '')) {
        // 哈萨克语西里尔文字
        return word.notation || ''
      } else {
        // 哈萨克语老文字
        return word.trans[2]
      }
    } else {
      return word.name
    }
  }
  const { play, stop, isPlaying } = usePronunciationSound(currentWord(), undefined, onPlaybackComplete)

  const playSound = useCallback(() => {
    stop()
    if (play()) onPlaybackStart?.()
    else onPlaybackComplete?.()
  }, [play, stop, onPlaybackStart, onPlaybackComplete])

  useEffect(() => {
    return stop
  }, [word, stop])

  useEffect(() => {
    if (autoPlay && !paused) playSound()
  }, [autoPlay, paused, playSound])

  useEffect(() => {
    if (paused) stop()
  }, [paused, stop])

  useImperativeHandle(
    ref,
    () => ({
      play: playSound,
    }),
    [playSound],
  )

  return (
    <SoundIcon
      animated={isPlaying}
      onClick={playSound}
      className={`cursor-pointer text-gray-600 ${className}`}
      iconClassName={iconClassName}
    />
  )
})

WordPronunciationIcon.displayName = 'WordPronunciationIcon'

export type WordPronunciationIconRef = {
  play: () => void
}
