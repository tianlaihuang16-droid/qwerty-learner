import { enqueueCloudWrite, resumeCloudQueue } from './cloudQueue'
import type { CloudDictionaryResource } from '@/resources/dictionary'
import { registerCloudDictionaryResources } from '@/resources/dictionary'
import { invoke } from '@tauri-apps/api/tauri'

export const CLOUD_SYNC_ROOT = ''

type CloudSyncState = {
  root: string
  dictionaries: CloudDictionaryResource[]
  errors: string[]
}

type StudyEventKind = 'word' | 'chapter' | 'rating-correction'

function localDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function eventId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function initializeCloudSync(): Promise<CloudSyncState | undefined> {
  try {
    const state = await invoke<CloudSyncState>('initialize_cloud_sync')
    registerCloudDictionaryResources(state.dictionaries)
    localStorage.setItem('qwerty-cloud-sync-root', state.root)
    localStorage.setItem('qwerty-cloud-sync-errors', JSON.stringify(state.errors))
    resumeCloudQueue()
    void import('./db/training-service').then(({ flushTrainingOutbox }) => flushTrainingOutbox())
    return state
  } catch (error) {
    console.error('Failed to initialize cloud sync', error)
    throw error
  }
}

export async function appendCloudStudyEvent(kind: StudyEventKind, payload: Record<string, unknown>) {
  const id = eventId()
  await enqueueCloudWrite(`event:${id}`, 'append_cloud_study_event', {
    kind,
    date: localDate(),
    event: {
      eventId: id,
      recordedAt: new Date().toISOString(),
      ...payload,
    },
  })
}

let lastProgressSync = 0

export function syncCloudProgress(progress: Record<string, unknown>, force = false) {
  const now = Date.now()
  if (!force && now - lastProgressSync < 15_000) return
  lastProgressSync = now
  void enqueueCloudWrite('current-progress', 'write_cloud_progress', {
    progress: {
      savedAt: new Date().toISOString(),
      ...progress,
    },
  }).catch((error) => console.error('Failed to sync current progress', error))
}

export async function writeAlgorithmReviewPlan(plan: unknown) {
  await enqueueCloudWrite('review-plan', 'write_cloud_review_plan', { plan })
}

/**
 * Queues a full records backup into the cloud `backups/` directory. The queue keeps the
 * payload durable until Tauri accepts it, so a snapshot survives a failed write.
 */
export function scheduleCloudSnapshot(family: string, stamp: string, data: Uint8Array, keep: number) {
  void enqueueCloudWrite(`snapshot:${family}:${stamp}`, 'write_cloud_snapshot', {
    family,
    stamp,
    data: Array.from(data),
    keep,
  }).catch((error) => console.error('Failed to queue records snapshot', error))
}

export async function readGptReviewAdjustments(): Promise<unknown | undefined> {
  try {
    const content = await invoke<string | null>('read_cloud_review_adjustments')
    return content ? JSON.parse(content) : undefined
  } catch (error) {
    console.error('Failed to read GPT review adjustments', error)
    return undefined
  }
}

export async function reportCloudSyncError(area: string, error: unknown) {
  try {
    await invoke('write_cloud_error', { area, message: error instanceof Error ? error.message : String(error) })
  } catch {
    // Browser builds and failures before Tauri IPC is ready have no cloud error channel.
  }
}
