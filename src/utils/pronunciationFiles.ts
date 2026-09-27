import { invoke } from '@tauri-apps/api/tauri'
import Dexie from 'dexie'

export type PronunciationFile = { url: string; blob: Blob; source: string; savedAt: number }
const files = new Dexie('PronunciationAudioDB')
files.version(1).stores({ audio: 'url,savedAt' })
const table = files.table<PronunciationFile, string>('audio')
const fallback = new Map<string, Promise<PronunciationFile | undefined>>()
const desktop = () => '__TAURI_IPC__' in window
let networkFailures = 0
let useOfflineUntil = 0

// Read the persisted pronunciation config directly: this module also runs outside React.
function offlineSynthesisAllowed() {
  try {
    const raw = localStorage.getItem('pronunciation')
    return raw ? JSON.parse(raw)?.allowOfflineSynthesis === true : false
  } catch {
    return false
  }
}

function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Audio preparation timed out')), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export async function primeOfflinePronunciations(urls: string[]) {
  if (!desktop() || !offlineSynthesisAllowed()) return
  const existing = await table.bulkGet(urls)
  for (const [type, culture] of [
    ['2', 'en-US'],
    ['1', 'en-GB'],
  ]) {
    const missing = urls.filter((url, index) => !existing[index] && new URL(url).searchParams.get('type') === type && !fallback.has(url))
    if (!missing.length) continue
    const words = missing.map((url) => new URL(url).searchParams.get('audio') ?? '')
    type Synthesized = { word: string; base64: string; voice: string; culture: string }
    const batch = deadline(invoke<Synthesized[]>('synthesize_pronunciations', { words, culture }), 25000).catch(() => [])
    missing.forEach((url, index) => {
      fallback.set(
        url,
        batch.then((rows) => {
          const row = rows.find((item) => item.word === words[index] && item.culture === culture)
          if (!row) return undefined
          const bytes = Uint8Array.from(atob(row.base64), (char) => char.charCodeAt(0))
          return {
            url,
            blob: new Blob([bytes], { type: 'audio/wav' }),
            source: `windows-tts:${row.culture}:${row.voice}`,
            savedAt: Date.now(),
          }
        }),
      )
    })
  }
}

function audioBlob(bytes: Uint8Array): Blob {
  const wave = String.fromCharCode(...Array.from(bytes.slice(0, 4))) === 'RIFF'
  const id3 = String.fromCharCode(...Array.from(bytes.slice(0, 3))) === 'ID3'
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  if (bytes.length < 64 || bytes.length > 2097152 || (!wave && !id3 && !frame)) throw new Error('Invalid audio response')
  return new Blob([bytes], { type: wave ? 'audio/wav' : 'audio/mpeg' })
}

// The Youdao URL doubles as the cache key and carries the word plus accent/language parameters,
// so the remaining sources are derived from it. Order: Youdao -> real recordings -> Google TTS.
// Youdao stalls for a few seconds on a minority of requests, so the primary source gets a longer
// budget than the optional fallbacks.
export function pronunciationCandidates(youdaoUrl: string): { source: string; url: string; timeoutMs: number }[] {
  const candidates = [{ source: 'youdao', url: youdaoUrl, timeoutMs: 10000 }]
  let word = ''
  let type: string | null = null
  let language: string | null = null
  try {
    const parsed = new URL(youdaoUrl)
    word = parsed.searchParams.get('audio') ?? ''
    type = parsed.searchParams.get('type')
    language = parsed.searchParams.get('le')
  } catch {
    return candidates
  }
  if (!word) return candidates
  const encoded = encodeURIComponent(word)
  const dictvoice = (query: string) => `https://dict.youdao.com/dictvoice?audio=${encoded}${query}`
  if (!language) {
    // The same host serves the other accent and a language-agnostic endpoint. The requested variant
    // stalls for a minority of words on some networks, and one of these answers immediately, so they
    // come before the optional third-party sources.
    if (type === '1') candidates.push({ source: 'youdao-alt', url: dictvoice('&type=2'), timeoutMs: 6000 })
    else if (type === '2') candidates.push({ source: 'youdao-alt', url: dictvoice('&type=1'), timeoutMs: 6000 })
    candidates.push({ source: 'youdao-en', url: dictvoice('&le=en'), timeoutMs: 6000 })
  }
  if (!language && (type === '1' || type === '2')) {
    candidates.push({
      source: 'dictionaryapi',
      url: `https://api.dictionaryapi.dev/media/pronunciations/en/${encoded}-${type === '1' ? 'uk' : 'us'}.mp3`,
      timeoutMs: 4000,
    })
  }
  const target =
    type === '1'
      ? 'en-GB'
      : type === '2'
        ? 'en-US'
        : language === 'jap'
          ? 'ja'
          : language === 'zh' || language === 'de' || language === 'ru' || language === 'id'
            ? language
            : ''
  if (target)
    candidates.push({
      source: 'google-tts',
      url: `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${target}&q=${encoded}`,
      timeoutMs: 4000,
    })
  return candidates
}

async function downloadBytes(url: string, timeoutMs: number): Promise<Uint8Array> {
  if (desktop()) return new Uint8Array(await deadline(invoke<number[]>('download_pronunciation', { url }), timeoutMs))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 3000))
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

export async function getPronunciationFile(url: string): Promise<PronunciationFile> {
  const saved = await table.get(url)
  if (saved) return saved
  const offline = Date.now() < useOfflineUntil
  if (offline && fallback.has(url)) {
    const local = await fallback.get(url)
    if (local) return local
  }
  // While the network is known to be failing, retry only the primary source to stay fast.
  const all = pronunciationCandidates(url)
  const candidates = offline ? all.slice(0, 1) : all
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const blob = audioBlob(await downloadBytes(candidate.url, candidate.timeoutMs))
      networkFailures = 0
      return { url, blob, source: candidate.source, savedAt: Date.now() }
    } catch (error) {
      lastError = error
    }
  }
  if (++networkFailures >= 2) useOfflineUntil = Date.now() + 60000
  if (!offlineSynthesisAllowed()) throw lastError instanceof Error ? lastError : new Error('Pronunciation unavailable')
  if (!fallback.has(url)) await primeOfflinePronunciations([url])
  const local = await fallback.get(url)
  if (!local) throw lastError
  return local
}

// Persist only after the audio decoder has accepted the complete file.
export const savePronunciationFile = async (file: PronunciationFile) => {
  await table.put(file)
  fallback.delete(file.url)
}
export const deletePronunciationFile = (url: string) => table.delete(url)
