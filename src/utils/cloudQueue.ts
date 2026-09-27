import { invoke } from '@tauri-apps/api/tauri'
import Dexie, { Table } from 'dexie'

type PendingSync = { id: string; revision: string; command: string; args: Record<string, unknown>; createdAt: number }
class CloudQueueDB extends Dexie {
  pending!: Table<PendingSync, string>
  constructor() {
    super('CloudQueueDB')
    this.version(1).stores({ pending: 'id,createdAt' })
  }
}
export const cloudQueueDb = new CloudQueueDB()
let timer: ReturnType<typeof setTimeout> | undefined
let active: Promise<void> | undefined
let retryDelay = 1000

export function isDesktopSync() {
  return typeof (window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function'
}

function schedule(delay = 1000) {
  if (timer || !isDesktopSync()) return
  timer = setTimeout(() => {
    timer = undefined
    void flushCloudQueue().catch((error) => console.error('Cloud queue unavailable', error))
  }, delay)
}

export async function enqueueCloudWrite(id: string, command: string, args: Record<string, unknown>) {
  if (!isDesktopSync()) return
  await cloudQueueDb.pending.put({ id, command, args, revision: crypto.randomUUID(), createdAt: Date.now() })
  schedule()
}

export function resumeCloudQueue() {
  schedule(0)
}

export function flushCloudQueue(): Promise<void> {
  if (active) return active
  if (!isDesktopSync()) return Promise.resolve()
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  active = drain().finally(() => {
    active = undefined
  })
  return active
}

async function drain() {
  for (;;) {
    const item = await cloudQueueDb.pending.orderBy('createdAt').first()
    if (!item) return
    try {
      await invoke(item.command, item.args)
      await cloudQueueDb.transaction('rw', cloudQueueDb.pending, async () => {
        // A newer progress snapshot may have replaced this item during IPC.
        if ((await cloudQueueDb.pending.get(item.id))?.revision === item.revision) await cloudQueueDb.pending.delete(item.id)
      })
      retryDelay = 1000
    } catch (error) {
      retryDelay = Math.min(retryDelay * 2, 60000)
      schedule(retryDelay)
      console.error('Cloud write postponed; durable copy retained', error)
      return
    }
  }
}

window.addEventListener('online', resumeCloudQueue)
window.addEventListener('pagehide', () => {
  void flushCloudQueue().catch(() => undefined)
})
