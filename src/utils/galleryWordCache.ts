import type { Word } from '@/typings'

// Built-in resources are immutable for the lifetime of this app. Cloud files are
// refreshed on gallery entry and window activation, including unchanged URLs.
export function createGalleryWordCache(read: (url: string) => Promise<Word[]>) {
  const entries = new Map<string, Promise<Word[]>>()
  return {
    read(url: string) {
      let pending = entries.get(url)
      if (!pending) {
        pending = read(url).then((words) => {
          if (!Array.isArray(words) || words.some((word) => !word || typeof word.name !== 'string')) {
            throw new Error(`词书格式无效：${url}`)
          }
          return words
        }).catch((error) => {
          if (entries.get(url) === pending) entries.delete(url)
          throw error
        })
        entries.set(url, pending)
      }
      return pending
    },
    invalidateCloud() {
      for (const url of Array.from(entries.keys())) if (url.startsWith('cloud://')) entries.delete(url)
    },
  }
}
