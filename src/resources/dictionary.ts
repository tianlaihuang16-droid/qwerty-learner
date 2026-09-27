import type { Dictionary, DictionaryResource } from '@/typings/index'
import { calcChapterCount } from '@/utils/calcChapterCount'

export const DEFAULT_DICTIONARY_ID = 'cet4'
export const dictionaryResources: DictionaryResource[] = [
  {
    id: 'cet4',
    name: 'CET-4',
    description: '大学英语四级词库（演示）',
    category: '中国考试',
    tags: ['大学英语'],
    url: '/dicts/CET4_T.json',
    length: 2607,
    language: 'en',
    languageCategory: 'en',
  },
]

export const dictionaries: Dictionary[] = dictionaryResources.map((resource) => ({
  ...resource,
  chapterCount: calcChapterCount(resource.length),
}))

/**
 * An object-map from dictionary IDs to dictionary themselves.
 */
export const idDictionaryMap: Record<string, Dictionary> = Object.fromEntries(dictionaries.map((dict) => [dict.id, dict]))

export type CloudDictionaryResource = Omit<DictionaryResource, 'url'> & { location: string }

export function registerCloudDictionaryResources(resources: CloudDictionaryResource[]) {
  for (const cloudResource of resources) {
    const resource: DictionaryResource = {
      ...cloudResource,
      url: `cloud://${cloudResource.location}`,
    }
    const existingResourceIndex = dictionaryResources.findIndex((item) => item.id === resource.id)
    if (existingResourceIndex >= 0) {
      dictionaryResources[existingResourceIndex] = resource
    } else {
      dictionaryResources.push(resource)
    }

    const dictionary: Dictionary = { ...resource, chapterCount: calcChapterCount(resource.length) }
    const existingDictionaryIndex = dictionaries.findIndex((item) => item.id === dictionary.id)
    if (existingDictionaryIndex >= 0) {
      dictionaries[existingDictionaryIndex] = dictionary
    } else {
      dictionaries.push(dictionary)
    }
    idDictionaryMap[dictionary.id] = dictionary
  }
}
