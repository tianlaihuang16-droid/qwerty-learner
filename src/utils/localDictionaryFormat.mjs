/** Parse a Qwerty Learner JSON word list without trusting imported data. */
export function parseLocalDictionary(fileName, text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${fileName} 不是有效的 JSON 文件`)
  }
  const entries = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.words) ? parsed.words : null
  if (!entries) throw new Error('辞书须为单词数组，或包含 words 数组的对象')
  if (entries.length === 0) throw new Error('辞书至少包含一个单词')
  if (entries.length > 50000) throw new Error('单本辞书最多包含 50000 个单词')

  const seen = new Set()
  const words = []
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string') {
      throw new Error(`第 ${index + 1} 个单词缺少有效的 name`)
    }
    const name = entry.name.trim()
    if (!name || name.length > 100) throw new Error(`第 ${index + 1} 个单词的 name 无效`)
    const rawTrans = entry.trans
    let trans
    if (rawTrans === undefined || rawTrans === null) trans = []
    else if (typeof rawTrans === 'string') trans = [rawTrans]
    else if (Array.isArray(rawTrans) && rawTrans.every((item) => typeof item === 'string')) trans = rawTrans
    else throw new Error(`第 ${index + 1} 个单词的 trans 必须是文字或文字数组`)
    if (entry.usphone !== undefined && typeof entry.usphone !== 'string') throw new Error(`第 ${index + 1} 个单词的 usphone 无效`)
    if (entry.ukphone !== undefined && typeof entry.ukphone !== 'string') throw new Error(`第 ${index + 1} 个单词的 ukphone 无效`)
    const key = name.normalize('NFC').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    words.push({ name, trans, usphone: entry.usphone ?? '', ukphone: entry.ukphone ?? '' })
  }
  if (words.length === 0) throw new Error('辞书至少包含一个单词')
  return words
}
