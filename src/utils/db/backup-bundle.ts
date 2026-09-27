import { db } from '.'
import { captureBackupStorage, normalizeBackupDocument } from './backup-format'
import { flushTypingProgress } from '@/utils/typingProgress'

export type BackupBundle = { compressed: Uint8Array; wordCount: number; chapterCount: number }

export type BackupBundleProgress = (progress: { totalRows?: number; completedRows: number; done: boolean }) => boolean

/**
 * Builds the exact document the user-facing export writes, so automatic snapshots and
 * manual backups stay importable through the same restore path.
 */
export async function buildBackupBundle(progressCallback?: BackupBundleProgress): Promise<BackupBundle> {
  flushTypingProgress()
  const [pako] = await Promise.all([import('pako'), import('dexie-export-import')])

  const blob = await db.export(progressCallback ? { progressCallback } : {})
  const [wordCount, chapterCount] = await Promise.all([db.wordRecords.count(), db.chapterRecords.count()])

  const document = JSON.parse(await blob.text())
  normalizeBackupDocument(document)
  document.qwertyBackup = {
    version: 1,
    savedAt: new Date().toISOString(),
    localStorage: captureBackupStorage(window.localStorage),
    reviewSchedule: 'rebuild-from-history',
  }
  return { compressed: pako.gzip(JSON.stringify(document)), wordCount, chapterCount }
}
