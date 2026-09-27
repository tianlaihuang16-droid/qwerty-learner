import { db } from '.'
import { buildBackupBundle } from './backup-bundle'
import { isDesktopSync } from '@/utils/cloudQueue'
import { scheduleCloudSnapshot } from '@/utils/cloudSync'

export const DAILY_SNAPSHOT_KEEP = 14
export const PRE_IMPORT_SNAPSHOT_KEEP = 6

const DAILY_SNAPSHOT_KEY = 'qwerty-records-snapshot-date'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function dayStamp(date: Date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function timeStamp(date: Date) {
  return `${dayStamp(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function snapshotRecords(family: string, stamp: string, keep: number) {
  const wordCount = await db.wordRecords.count()
  if (wordCount === 0) {
    // Never let an emptied database replace the last usable snapshot.
    console.warn('Skipping records snapshot because there are no word records')
    return false
  }
  const bundle = await buildBackupBundle()
  if (bundle.wordCount === 0) return false
  scheduleCloudSnapshot(family, stamp, bundle.compressed, keep)
  return true
}

/** 启动时每天一份滚动快照，用于在本地 IndexedDB 被意外清空后恢复。 */
export async function saveDailyRecordsSnapshot(now = new Date()) {
  if (!isDesktopSync()) return
  const today = dayStamp(now)
  if (window.localStorage.getItem(DAILY_SNAPSHOT_KEY) === today) return
  const saved = await snapshotRecords('records', today, DAILY_SNAPSHOT_KEEP)
  if (saved) window.localStorage.setItem(DAILY_SNAPSHOT_KEY, today)
}

/** 导入会先清空本地表，所以导入前必须留下最后一份可回退的副本。 */
export async function savePreImportRecordsSnapshot(now = new Date()) {
  if (!isDesktopSync()) return
  await snapshotRecords('pre-import', timeStamp(now), PRE_IMPORT_SNAPSHOT_KEEP)
}
