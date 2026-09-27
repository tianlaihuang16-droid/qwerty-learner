import { registerLocalDictionaryResources } from '@/resources/dictionary'
import type { Word } from '@/typings'
import { parseLocalDictionary } from './localDictionaryFormat.mjs'
import Dexie from 'dexie'

export type LocalDictionary = {
  id: string
  name: string
  length: number
  words: Word[]
  importedAt: number
}

const localDb = new Dexie('QwertyLocalDictionaries')
localDb.version(1).stores({ dictionaries: 'id' })
const localDictionaries = localDb.table<LocalDictionary, string>('dictionaries')

export async function loadLocalDictionaries(): Promise<void> {
  const saved = await localDictionaries.toArray()
  registerLocalDictionaryResources(saved)
}

export async function readLocalDictionary(id: string): Promise<Word[]> {
  const saved = await localDictionaries.get(id)
  if (!saved) throw new Error('本地辞书不存在，请重新导入原始辞书文件')
  return saved.words
}

export async function importLocalDictionary(file: File): Promise<LocalDictionary> {
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 .json 辞书文件')
  if (file.size > 10 * 1024 * 1024) throw new Error('辞书文件不能超过 10 MB')
  const words = parseLocalDictionary(file.name, await file.text()) as Word[]
  const bytes = new TextEncoder().encode(JSON.stringify(words))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const id = `local-${Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, '0')).join('')}`
  const name = file.name.replace(/\.json$/i, '').trim() || '我的辞书'
  const saved: LocalDictionary = { id, name, length: words.length, words, importedAt: Date.now() }
  await localDictionaries.put(saved)
  registerLocalDictionaryResources([saved])
  return saved
}
