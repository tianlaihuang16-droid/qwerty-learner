import { db } from '@/utils/db'
import { buildFsrsOptimizationDataset, splitFsrsOptimizationDataset } from '@/utils/db/fsrs-optimization'
import { DEFAULT_FSRS_VERSION, getFsrsParameters, isFsrsWeights, resetFsrsParameters, saveFsrsParameters } from '@/utils/db/fsrs-parameters'
import { runStudyWrite } from '@/utils/db/maintenance'
import { invoke } from '@tauri-apps/api/tauri'
import { useRef, useState } from 'react'

type Candidate = {
  weights: number[]
  defaultLoss: number
  currentLoss: number
  candidateLoss: number
  trainCount: number
  validationCount: number
  wordCount: number
  currentVersion: string
}

export default function FsrsSetting() {
  const [version, setVersion] = useState(() => {
    try {
      return getFsrsParameters().version
    } catch {
      return '参数无效'
    }
  })
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [message, setMessage] = useState('')
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const better = candidate && candidate.candidateLoss < Math.min(candidate.defaultLoss, candidate.currentLoss)
  async function optimize() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setCandidate(null)
    setMessage('正在检查复习历史…')
    try {
      const parameters = getFsrsParameters()
      const dataset = buildFsrsOptimizationDataset(await db.wordRecords.toArray())
      const { train, validation } = splitFsrsOptimizationDataset(dataset.items)
      setMessage('正在本机优化参数，请稍候…')
      const result = await invoke<Pick<Candidate, 'weights' | 'defaultLoss' | 'currentLoss' | 'candidateLoss'>>(
        'optimize_fsrs_parameters',
        { input: { train, validation, currentWeights: parameters.weights } },
      )
      if (
        !isFsrsWeights(result.weights) ||
        ![result.defaultLoss, result.currentLoss, result.candidateLoss].every((v) => Number.isFinite(v) && v >= 0)
      )
        throw new Error('优化器返回了无效结果')
      setCandidate({
        ...result,
        trainCount: train.length,
        validationCount: validation.length,
        wordCount: dataset.wordCount,
        currentVersion: parameters.version,
      })
      setMessage('优化完成，点击“应用个人参数”后生效。')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessage(text.includes('__TAURI') || text.includes('ipc') ? '参数优化需要在桌面软件中运行。' : text)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  async function apply() {
    if (!candidate || !better) return
    try {
      await runStudyWrite(async () => {
        if (getFsrsParameters().version !== candidate.currentVersion) throw new Error('当前参数已改变，请重新优化后再应用。')
        const now = Date.now()
        const parameters = { version: `fsrs6-personal-${now}-${crypto.randomUUID()}`, weights: candidate.weights, optimizedAt: now }
        saveFsrsParameters(parameters)
        setVersion(parameters.version)
      })
      setCandidate(null)
      setMessage('个人参数已应用，后续复习生效，已有截止时间保留。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  async function reset() {
    try {
      await runStudyWrite(async () => {
        resetFsrsParameters()
        setVersion(DEFAULT_FSRS_VERSION)
      })
      setCandidate(null)
      setMessage('已恢复默认参数，已有截止时间保留。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <section className="flex flex-col gap-3 border-t border-gray-200 py-4 text-sm dark:border-gray-700" data-testid="fsrs-optimization">
      <h3 className="font-semibold">FSRS 参数优化</h3>
      <p>当前使用：{version === DEFAULT_FSRS_VERSION ? '默认参数' : version === '参数无效' ? version : '个人参数'} · 目标记忆率 90%</p>
      <p className="text-xs leading-relaxed text-gray-500">
        根据本机完整的无提示复习历史优化。较新的 20%
        跨日复习用于验证；提示、重试及缺少初始记录的历史不用于训练。应用后仅影响后续评分与概率预测，已有复习截止时间保留。
      </p>
      <div className="flex gap-3">
        <button className="rounded bg-indigo-500 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={optimize}>
          {busy ? '正在优化…' : '优化参数'}
        </button>
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={busy || version === DEFAULT_FSRS_VERSION}
          onClick={reset}
        >
          恢复默认
        </button>
      </div>
      {message && (
        <p role="status" className="text-xs leading-relaxed">
          {message}
        </p>
      )}
      {candidate && (
        <div className="flex flex-col gap-2 rounded bg-gray-100 p-3 dark:bg-gray-800">
          <p>
            {candidate.wordCount} 个词 · 训练 {candidate.trainCount} 次 · 验证 {candidate.validationCount} 次
          </p>
          <p className="text-xs">
            预测误差（越小越好）：默认 {candidate.defaultLoss.toFixed(4)} · 当前 {candidate.currentLoss.toFixed(4)} · 候选{' '}
            {candidate.candidateLoss.toFixed(4)}
          </p>
          <p className="text-xs">
            {better ? '候选在保留的验证记录上更准确；短期结果仍可能波动。' : '候选未优于默认和当前参数，继续保留当前参数。'}
          </p>
          <button className="self-start rounded bg-indigo-500 px-4 py-2 text-white disabled:opacity-50" disabled={!better} onClick={apply}>
            应用个人参数
          </button>
        </div>
      )}
    </section>
  )
}
