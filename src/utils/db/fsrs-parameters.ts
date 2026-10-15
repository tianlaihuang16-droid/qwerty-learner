import { default_w } from 'ts-fsrs'

export const FSRS_PARAMETERS_KEY = 'fsrsParameters'
export const FSRS_PARAMETERS_EVENT = 'qwerty-fsrs-parameters'
export const DEFAULT_FSRS_VERSION = 'fsrs6-default-1'
export const DEFAULT_FSRS_WEIGHTS = [...default_w]
export type FsrsParameters = { version: string; weights: number[]; optimizedAt?: number }
// FSRS-6 scheduler limits for one relearning step, short-term enabled.
const bounds = [
  [0.001, 100],
  [0.001, 100],
  [0.001, 100],
  [0.001, 100],
  [1, 10],
  [0.001, 4],
  [0.001, 4],
  [0.001, 0.75],
  [0, 4.5],
  [0, 0.8],
  [0.001, 3.5],
  [0.001, 5],
  [0.001, 0.25],
  [0.001, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, 2],
  [0, 2],
  [0.01, 0.8],
  [0.1, 0.8],
]

export function isFsrsWeights(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 21 &&
    value.every((w, i) => typeof w === 'number' && Number.isFinite(w) && w >= bounds[i][0] - 1e-7 && w <= bounds[i][1] + 1e-7)
  )
}

export function isFsrsParameters(value: unknown): value is FsrsParameters {
  const p = value as FsrsParameters | undefined
  return (
    !!p &&
    typeof p.version === 'string' &&
    /^fsrs6-personal-[a-zA-Z0-9-]{1,80}$/.test(p.version) &&
    isFsrsWeights(p.weights) &&
    typeof p.optimizedAt === 'number' &&
    Number.isFinite(p.optimizedAt) &&
    p.optimizedAt > 0
  )
}

export function getFsrsParameters(): FsrsParameters {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FSRS_PARAMETERS_KEY)
  if (raw) {
    const value: unknown = JSON.parse(raw)
    if (!isFsrsParameters(value)) throw new Error('个人 FSRS 参数无效，请恢复默认参数')
    return value
  }
  return { version: DEFAULT_FSRS_VERSION, weights: [...DEFAULT_FSRS_WEIGHTS] }
}

export function saveFsrsParameters(parameters: FsrsParameters) {
  if (!isFsrsParameters(parameters)) throw new Error('个人 FSRS 参数无效')
  localStorage.setItem(FSRS_PARAMETERS_KEY, JSON.stringify(parameters))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FSRS_PARAMETERS_EVENT))
}

export function resetFsrsParameters() {
  localStorage.removeItem(FSRS_PARAMETERS_KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FSRS_PARAMETERS_EVENT))
}

export function weightsForDecision(decision?: { schedulerWeights?: number[]; schedulerParamsVersion?: string }) {
  if (!decision) return getFsrsParameters()
  if (decision.schedulerWeights !== undefined) {
    if (!isFsrsWeights(decision.schedulerWeights)) throw new Error('历史 FSRS 参数无效')
    return { version: decision.schedulerParamsVersion ?? 'fsrs6-personal-history', weights: decision.schedulerWeights }
  }
  if (decision.schedulerParamsVersion && decision.schedulerParamsVersion !== DEFAULT_FSRS_VERSION)
    throw new Error('历史 FSRS 参数缺失，无法准确重放')
  return { version: DEFAULT_FSRS_VERSION, weights: [...DEFAULT_FSRS_WEIGHTS] }
}
