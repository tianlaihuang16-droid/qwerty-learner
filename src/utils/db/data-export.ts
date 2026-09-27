import { db, spacedReviewDb } from '.'
import { getCurrentDate, recordDataAction } from '..'
import { buildBackupBundle } from './backup-bundle'
import { captureBackupStorage, parseBackup, restoreBackupStorage } from './backup-format'
import { beginDataRestore, reportRestoreStatus } from './maintenance'
import type { ISpacedReviewState } from './record'
import { savePreImportRecordsSnapshot } from './records-snapshot'
import type { IWordFeedback } from './word-feedback'
import { rebuildSpacedReviewScheduleFromHistory, syncAlgorithmReviewPlan } from './spaced-review-service'
import { invoke } from '@tauri-apps/api/tauri'

export type ExportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export type ImportProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

export type ExportResult = { status: 'saved'; path?: string } | { status: 'cancelled' }

async function isTauriDesktop() {
  try {
    return await invoke<boolean>('is_desktop_app')
  } catch {
    return false
  }
}

export async function exportDatabase(callback: (exportProgress: ExportProgress) => boolean): Promise<ExportResult> {
  const { compressed, wordCount, chapterCount } = await buildBackupBundle(callback)
  const compressedBlob = new Blob([compressed])
  const currentDate = getCurrentDate()
  const filename = `Qwerty-Learner-User-Data-${currentDate}.gz`

  let savedPath: string | undefined
  if (await isTauriDesktop()) {
    const [{ save }, { writeBinaryFile }] = await Promise.all([import('@tauri-apps/api/dialog'), import('@tauri-apps/api/fs')])
    const selectedPath = await save({
      title: '选择练习进度的保存位置',
      defaultPath: filename,
      filters: [{ name: 'Qwerty Learner 备份', extensions: ['gz'] }],
    })
    if (!selectedPath) return { status: 'cancelled' }

    await writeBinaryFile(selectedPath, compressed)
    savedPath = selectedPath
  } else {
    const { saveAs } = await import('file-saver')
    saveAs(compressedBlob, filename)
  }

  recordDataAction({ type: 'export', size: compressedBlob.size, wordCount, chapterCount })
  return { status: 'saved', path: savedPath }
}

export async function importDatabase(file: File, callback: (importProgress: ImportProgress) => boolean): Promise<void> {
  const [pako] = await Promise.all([import('pako'), import('dexie-export-import')])
  // Validate the complete file before locking the app or touching existing data.
  const backup = parseBackup(pako.ungzip(await file.arrayBuffer(), { to: 'string' }))
  // A restore clears tables before importing. Keep the current records on disk first, because
  // an interrupted import leaves nothing in memory to roll back to.
  try {
    await savePreImportRecordsSnapshot()
  } catch (error) {
    console.error('Could not snapshot the current records before restoring', error)
  }
  await beginDataRestore()
  let previousDatabase: Blob | undefined
  let previousWordStates: ISpacedReviewState[] | undefined
  let previousStorage: ReturnType<typeof captureBackupStorage> | undefined
  let preservedLegacyFeedback: IWordFeedback[] | undefined
  let changed = false
  const importOptions = {
    acceptVersionDiff: true,
    acceptMissingTables: true,
    acceptNameDiff: false,
    acceptChangedPrimaryKey: false,
    overwriteValues: true,
    clearTablesBeforeImport: true,
  }
  try {
    previousDatabase = await db.export()
    previousWordStates = await spacedReviewDb.wordStates.toArray()
    previousStorage = captureBackupStorage(window.localStorage)
    if (!backup.hasWordFeedback) preservedLegacyFeedback = await db.wordFeedback.toArray()
    changed = true
    // db.import owns its transaction and reads a Blob before starting it. An outer
    // transaction would expire during that read. The snapshots above cover rollback.
    await db.reviewRecords.clear()
    await db.trainingRuns.clear()
    await db.trainingOutbox.clear()
    await db.import(backup.database, {
      ...importOptions,
      progressCallback: ({ totalRows, completedRows }) => callback({ totalRows, completedRows, done: false }),
    })
    await db.trainingOutbox.clear() // Imported history must not re-publish old events.
    if (preservedLegacyFeedback) {
      await db.wordFeedback.clear()
      if (preservedLegacyFeedback.length > 0) await db.wordFeedback.bulkPut(preservedLegacyFeedback)
    }
    reportRestoreStatus('正在根据恢复的学习记录重建复习计划…')
    await rebuildSpacedReviewScheduleFromHistory(false)
    restoreBackupStorage(window.localStorage, backup.storage)
  } catch (error) {
    try {
      if (changed && previousDatabase && previousWordStates && previousStorage) {
        await db.import(previousDatabase, importOptions)
        await spacedReviewDb.transaction('rw', spacedReviewDb.wordStates, async () => {
          await spacedReviewDb.wordStates.clear()
          await spacedReviewDb.wordStates.bulkPut(previousWordStates!)
        })
        restoreBackupStorage(window.localStorage, previousStorage)
      }
    } catch (rollbackError) {
      reportRestoreStatus('恢复失败，回滚也未完成。请保留原备份文件，重新打开后检查数据。', true)
      throw new Error(`恢复和回滚失败：${String(error)}；${String(rollbackError)}`)
    }
    reportRestoreStatus(`恢复失败，原数据已保留。${error instanceof Error ? error.message : String(error)}`, true)
    throw error
  }
  // Cloud filesystem availability must not turn a successful local restore into a failure.
  try {
    await syncAlgorithmReviewPlan()
  } catch (error) {
    console.error('Restored locally; cloud review plan will be retried on startup', error)
  }
  callback({ completedRows: 0, done: true })
  reportRestoreStatus('备份恢复完成，正在重新打开…')
}
