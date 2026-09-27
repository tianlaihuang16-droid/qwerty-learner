// Deliberately exclude analytics identifiers and machine-specific sync paths.
const SETTINGS = [
  'currentDict',
  'currentChapter',
  'reviewModeInfo',
  'loopWordConfig',
  'keySoundsConfig',
  'hintSoundsConfig',
  'pronunciation',
  'fontsize',
  'randomConfig',
  'isShowPrevAndNextWord',
  'isIgnoreCase',
  'isShowAnswerOnHover',
  'isTextSelectable',
  'includeLearnedWords',
  'phoneticConfig',
  'isOpenDarkModeAtom',
  'wordDictationConfig',
  'gptReviewAdjustmentsEnabled',
  'dismissStartCardDate',
  'hasSeenEnhancedPromotion',
  'donateDate',
]
const PROGRESS_PREFIX = 'qwertyTypingProgress:v1:'
export type BackupStorage = Record<string, string>

export function isBackupStorageKey(key: string) {
  return SETTINGS.includes(key) || key.startsWith(PROGRESS_PREFIX)
}

/**
 * dexie-export-import wraps a row as `{ $: row, $types: {...} }` when it cannot serialize it
 * directly, and an earlier restore stored such wrappers verbatim. The wrapper is not part of the
 * record schema: it hides `word`/`dict` from validation and would be replayed into the database
 * as garbage. Strip it on the export and the import side alike.
 */
export function normalizeBackupRow(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  let record = row as Record<string, unknown>
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = record.$
    if (record.$types === undefined || !nested || typeof nested !== 'object' || Array.isArray(nested)) break
    record = nested as Record<string, unknown>
  }
  if (record.$types === undefined) return record
  const rest = { ...record }
  delete rest.$types
  return rest
}

export function normalizeBackupDocument(document: unknown) {
  const chunks = (document as { data?: { data?: unknown } } | undefined)?.data?.data
  if (!Array.isArray(chunks)) return
  for (const chunk of chunks) {
    const rows = (chunk as { rows?: unknown } | undefined)?.rows
    if (Array.isArray(rows)) (chunk as { rows: unknown[] }).rows = rows.map(normalizeBackupRow)
  }
}

export function captureBackupStorage(storage: Storage): BackupStorage {
  const snapshot: BackupStorage = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && isBackupStorageKey(key)) {
      const value = storage.getItem(key)
      if (value !== null) snapshot[key] = value
    }
  }
  return snapshot
}

export function restoreBackupStorage(storage: Storage, snapshot?: BackupStorage) {
  const oldKeys = Object.keys(captureBackupStorage(storage))
  oldKeys.forEach((key) => {
    // Old backups have no preferences. Keep preferences, but discard unrelated sessions.
    if (snapshot || key.startsWith(PROGRESS_PREFIX) || key === 'reviewModeInfo') storage.removeItem(key)
  })
  if (snapshot) Object.entries(snapshot).forEach(([key, value]) => storage.setItem(key, value))
}

export function parseBackup(json: string): { database: Blob; storage?: BackupStorage; hasWordFeedback: boolean } {
  const document = JSON.parse(json)
  // Older exports can still contain serializer wrappers; normalize before validating or replaying.
  normalizeBackupDocument(document)
  if (document?.formatName !== 'dexie' || document.formatVersion !== 1 || document.data?.databaseName !== 'RecordDB') {
    throw new Error('这不是受支持的 Qwerty Learner 备份')
  }
  const { tables, data, databaseVersion } = document.data
  const knownTables = ['wordRecords', 'chapterRecords', 'reviewRecords', 'trainingRuns', 'trainingOutbox', 'wordFeedback']
  if (!Number.isFinite(databaseVersion) || databaseVersion < 1 || databaseVersion > 5 || !Array.isArray(tables) || !Array.isArray(data)) {
    throw new Error('备份版本或数据结构无效')
  }
  const tableNames = tables.map((table) => table?.name)
  if (
    !tableNames.includes('wordRecords') ||
    !tableNames.includes('chapterRecords') ||
    new Set(tableNames).size !== tableNames.length ||
    tableNames.some((name) => !knownTables.includes(name))
  ) {
    throw new Error('备份缺少学习记录或包含未知数据表')
  }
  for (const table of tables) {
    const chunks = data.filter((chunk) => chunk?.tableName === table.name)
    if (
      typeof table.schema !== 'string' ||
      !Number.isInteger(table.rowCount) ||
      table.rowCount < 0 ||
      chunks.some((chunk) => chunk.inbound !== true || !Array.isArray(chunk.rows)) ||
      chunks.reduce((count, chunk) => count + chunk.rows.length, 0) !== table.rowCount
    ) {
      throw new Error('备份数据不完整，未更改现有记录')
    }
    if (table.name === 'wordRecords') {
      for (const chunk of chunks) {
        for (const row of chunk.rows) {
          // v1 used errorCount; normalize it before replaying history.
          if (row && row.wrongCount === undefined && Number.isFinite(row.errorCount)) row.wrongCount = row.errorCount
          if (
            !row ||
            typeof row.word !== 'string' ||
            !row.word.trim() ||
            typeof row.dict !== 'string' ||
            !Number.isFinite(row.timeStamp) ||
            !Array.isArray(row.timing) ||
            row.timing.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < 0) ||
            !Number.isFinite(row.wrongCount) ||
            row.wrongCount < 0
          ) {
            throw new Error('备份中的逐词记录无效，未更改现有记录')
          }
        }
      }
    }
    if (table.name === 'wordFeedback') {
      for (const chunk of chunks) {
        for (const row of chunk.rows) {
          if (
            !row ||
            typeof row.scope !== 'string' ||
            !row.scope ||
            typeof row.normalizedWord !== 'string' ||
            !row.normalizedWord ||
            typeof row.word !== 'string' ||
            !Array.isArray(row.sourceDicts) ||
            row.sourceDicts.some((dictID: unknown) => typeof dictID !== 'string' || !dictID) ||
            typeof row.blacklisted !== 'boolean' ||
            !Number.isInteger(row.notHelpfulCount) ||
            row.notHelpfulCount < 0 ||
            !Number.isFinite(row.updatedAt)
          ) {
            throw new Error('备份中的词条反馈无效，未更改现有记录')
          }
        }
      }
    }
  }
  if (data.some((chunk) => !tableNames.includes(chunk?.tableName))) throw new Error('备份包含未知数据表')

  let storage: BackupStorage | undefined
  if (document.qwertyBackup !== undefined) {
    const extra = document.qwertyBackup
    if (extra?.version !== 1 || !extra.localStorage || typeof extra.localStorage !== 'object' || Array.isArray(extra.localStorage)) {
      throw new Error('备份中的进度和设置无效')
    }
    storage = {}
    for (const [key, value] of Object.entries(extra.localStorage)) {
      if (!isBackupStorageKey(key) || typeof value !== 'string') throw new Error('备份包含不受支持的设置')
      // Date-only promotional preferences were stored without JSON encoding.
      if (key !== 'donateDate') {
        const parsed = JSON.parse(value)
        if (key.startsWith(PROGRESS_PREFIX) && (parsed?.version !== 1 || !parsed.snapshot?.chapterData || !parsed.snapshot?.timerData)) {
          throw new Error('备份中的章节进度无效')
        }
        const objectSettings = [
          'reviewModeInfo',
          'loopWordConfig',
          'keySoundsConfig',
          'hintSoundsConfig',
          'pronunciation',
          'fontsize',
          'randomConfig',
          'phoneticConfig',
          'wordDictationConfig',
        ]
        if (objectSettings.includes(key) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
          throw new Error('备份中的设置类型无效')
        if (key === 'currentDict' && typeof parsed !== 'string') throw new Error('备份词库选择无效')
        if (key === 'currentChapter' && !Number.isInteger(parsed)) throw new Error('备份章节选择无效')
        if (
          (key.startsWith('is') ||
            key === 'includeLearnedWords' ||
            key === 'gptReviewAdjustmentsEnabled' ||
            key === 'hasSeenEnhancedPromotion') &&
          typeof parsed !== 'boolean'
        )
          throw new Error('备份开关设置无效')
      }
      storage[key] = value
    }
  }
  delete document.qwertyBackup
  return { database: new Blob([JSON.stringify(document)]), storage, hasWordFeedback: tableNames.includes('wordFeedback') }
}
