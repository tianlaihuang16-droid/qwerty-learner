export const DATA_RESTORE_EVENT = 'qwerty-data-restore'

let restoring = false
let analysisClosing = false
const pendingWrites = new Set<Promise<unknown>>()

export const isDataRestoring = () => restoring

export function runStudyWrite<T>(write: () => Promise<T>): Promise<T> {
  if (restoring) return Promise.reject(new Error('正在恢复备份，请稍候'))
  if (analysisClosing) return Promise.reject(new Error('正在保存分析快照，请稍候'))
  const pending = write()
  pendingWrites.add(pending)
  void pending.then(
    () => pendingWrites.delete(pending),
    () => pendingWrites.delete(pending),
  )
  return pending
}

export async function settleStudyWritesForClose() {
  analysisClosing = true
  while (pendingWrites.size) await Promise.allSettled(Array.from(pendingWrites))
}

export function resumeStudyWritesAfterAnalysisCloseFailure() { analysisClosing = false }

export function reportRestoreStatus(message: string, failed = false) {
  window.dispatchEvent(new CustomEvent(DATA_RESTORE_EVENT, { detail: { message, failed } }))
}

export async function beginDataRestore() {
  if (restoring) throw new Error('正在恢复备份，请勿重复导入')
  restoring = true
  reportRestoreStatus('正在恢复备份，请保持窗口打开…')
  await Promise.allSettled(Array.from(pendingWrites))
  const { flushTrainingOutbox } = await import('./training-service')
  await flushTrainingOutbox()
  const { flushCloudQueue, cloudQueueDb } = await import('@/utils/cloudQueue')
  await flushCloudQueue()
  await cloudQueueDb.pending.clear()
  // Remain locked until reload, so mounted atoms cannot write stale progress back.
}
