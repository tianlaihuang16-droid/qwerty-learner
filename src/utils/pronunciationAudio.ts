import { deletePronunciationFile, getPronunciationFile, primeOfflinePronunciations, savePronunciationFile } from './pronunciationFiles'
import { balancedPronunciationBlob } from './pronunciationLoudness'
import { Howl } from 'howler'

type AudioEntry = {
  sound?: Howl
  users: number
  failed: boolean
  ready: Promise<void>
  objectUrl?: string
  source?: string
  disposed?: boolean
}
export type PronunciationOptions = { volume: number; rate: number; loop: boolean }
const cache = new Map<string, AudioEntry>()
const CACHE_LIMIT = 96

function trimCache(keep?: AudioEntry) {
  for (const [url, entry] of Array.from(cache)) {
    if (cache.size <= CACHE_LIMIT) break
    if (entry === keep || entry.users > 0 || !entry.sound) continue
    entry.disposed = true
    entry.sound.unload()
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
    cache.delete(url)
  }
}

function getAudio(url: string) {
  let entry = cache.get(url)
  if (entry?.failed && entry.users === 0) {
    entry.disposed = true
    entry.sound?.unload()
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
    cache.delete(url)
    entry = undefined
  }
  if (!entry) {
    entry = { users: 0, failed: false, ready: Promise.resolve() }
    const created = entry
    created.ready = (async () => {
      const file = await getPronunciationFile(url)
      if (created.disposed) return
      const playableBlob = await balancedPronunciationBlob(file.blob)
      if (created.disposed) return
      created.objectUrl = URL.createObjectURL(playableBlob)
      created.source = file.source
      const sound = new Howl({
        src: [created.objectUrl],
        html5: true,
        format: [playableBlob.type === 'audio/wav' ? 'wav' : 'mp3'],
        preload: false,
      })
      created.sound = sound
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            sound.unload()
            reject(new Error('Audio decode timed out'))
          }, 8000)
          sound.once('load', () => {
            clearTimeout(timer)
            resolve()
          })
          sound.once('loaderror', () => {
            clearTimeout(timer)
            reject(new Error('Cannot decode pronunciation'))
          })
          sound.load()
        })
      } catch (error) {
        await deletePronunciationFile(url)
        throw error
      }
      await savePronunciationFile(file)
    })().catch((error) => {
      created.failed = true
      throw error
    })
    // Callers await ready; avoid unhandled rejection if a caller has already left the chapter.
    void created.ready.catch(() => undefined)
  }
  cache.delete(url)
  cache.set(url, entry)
  trimCache(entry)
  return entry
}

export type ChapterAudioProgress = { ready: number; total: number; failed: string[]; synthesized: number; complete: boolean }
export async function preparePronunciationChapter(
  urls: string[],
  onProgress: (progress: ChapterAudioProgress) => void,
  cancelled: () => boolean,
) {
  const unique = Array.from(new Set(urls.filter(Boolean)))
  const progress: ChapterAudioProgress = { ready: 0, total: unique.length, failed: [], synthesized: 0, complete: false }
  onProgress({ ...progress })
  await primeOfflinePronunciations(unique)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(6, unique.length) }, async () => {
      while (cursor < unique.length && !cancelled()) {
        const url = unique[cursor++]
        const entry = getAudio(url)
        try {
          await entry.ready
          progress.ready++
          if (entry.source?.startsWith('windows-tts:')) progress.synthesized++
        } catch {
          progress.failed.push(url)
        }
        if (!cancelled()) onProgress({ ...progress, failed: [...progress.failed] })
      }
    }),
  )
  if (!cancelled()) onProgress({ ...progress, complete: true })
}

// Each caller owns its pending request and sound id; leaving a word cancels both.
export class PronunciationPlayback {
  private request = 0
  private entry?: AudioEntry
  private id?: number
  private detach?: () => void
  private options: PronunciationOptions = { volume: 1, rate: 1, loop: false }

  constructor(
    private url: string,
    private onPlaying: (playing: boolean) => void,
    private onComplete?: () => void,
  ) {}

  configure(options: PronunciationOptions) {
    this.options = options
    if (this.entry?.sound && this.id !== undefined) {
      this.entry.sound.volume(options.volume, this.id)
      this.entry.sound.rate(options.rate, this.id)
      this.entry.sound.loop(options.loop, this.id)
    }
  }

  play() {
    this.stop()
    const request = this.request
    if (!this.url) return false
    // Play only already-prepared audio: caching continues in the background, and words that are not
    // cached yet stay silent instead of blocking the chapter or fetching on demand.
    const prepared = cache.get(this.url)
    if (!prepared || prepared.failed || !prepared.sound || prepared.sound.state() !== 'loaded') return false
    const entry = getAudio(this.url)
    this.entry = entry
    entry.users++
    void entry.ready
      .then(() => {
        if (this.entry !== entry || this.request !== request || !entry.sound) return
        const sound = entry.sound
        const begin = () => {
          if (this.entry !== entry || this.id !== undefined) return
          sound.volume(this.options.volume)
          sound.rate(this.options.rate)
          sound.loop(this.options.loop)
          this.id = sound.play()
        }
        const onPlay = (id: number) => {
          if (id === this.id) this.onPlaying(true)
        }
        let completed = false
        const complete = () => {
          if (completed) return
          completed = true
          this.onComplete?.()
        }
        const onEnd = (id: number) => {
          if (id !== this.id) return
          complete()
          if (!this.options.loop) this.stop()
        }
        const onError = () => {
          complete()
          this.stop()
        }
        sound.on('play', onPlay)
        sound.on('end', onEnd)
        sound.on('loaderror', onError)
        sound.on('playerror', onError)
        sound.once('load', begin)
        this.detach = () => {
          sound.off('play', onPlay)
          sound.off('end', onEnd)
          sound.off('loaderror', onError)
          sound.off('playerror', onError)
          sound.off('load', begin)
        }
        if (sound.state() === 'loaded') begin()
        else if (sound.state() === 'unloaded') sound.load()
      })
      .catch(() => {
        if (this.entry === entry && this.request === request) {
          this.onComplete?.()
          this.stop()
        }
      })
    return true
  }

  stop() {
    this.request++
    this.detach?.()
    this.detach = undefined
    const entry = this.entry
    const id = this.id
    this.entry = undefined
    this.id = undefined
    if (entry) {
      if (id !== undefined) entry.sound?.stop(id)
      entry.users--
      trimCache()
    }
    this.onPlaying(false)
  }
}
