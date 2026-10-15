import type { Word } from '@/typings'
import { createGalleryWordCache } from './galleryWordCache'
import { readLocalDictionary } from './localDictionaries'
import { invoke } from '@tauri-apps/api/tauri'

export async function wordListFetcher(url: string): Promise<Word[]> {
  if (url.startsWith('local://')) return readLocalDictionary(url.slice('local://'.length))
  if (url.startsWith('cloud://')) {
    const content = await invoke<string>('read_cloud_dictionary', { location: url.slice('cloud://'.length) })
    return JSON.parse(content) as Word[]
  }

  const response = await fetch(import.meta.env.BASE_URL + url.replace(/^\/+/, ''))
  const words: Word[] = await response.json()
  return words
}

export const dictionaryWordCache = createGalleryWordCache(wordListFetcher)
