import type { TypingState } from '../store/type'
import { reviewModeInfoAtom } from '@/store'
import { registerAnalysisClosePreparation } from '@/utils/analysisSnapshot'
import { db } from '@/utils/db'
import { isRunEnded, saveTrainingProgress } from '@/utils/db/training-service'
import type { TrainingContext } from '@/utils/gptTraining'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function TrainingGuard({ children }: { children: (restored?: TypingState) => ReactNode }) {
  const review = useAtomValue(reviewModeInfoAtom)
  const context = review.isReviewMode ? review.reviewRecord?.gptTraining : undefined
  const [ready, setReady] = useState('')
  const [error, setError] = useState('')
  const [restored, setRestored] = useState<TypingState>()
  useEffect(() => {
    if (!context) return
    let cancelled = false
    let release: (() => void) | undefined
    const acquire = async () => {
      if (!navigator.locks) throw new Error('当前 WebView 不支持训练会话锁，请更新 WebView2')
      await navigator.locks.request(`qwerty-training:${context.sessionId}`, { ifAvailable: true }, async (lock) => {
        if (cancelled) return
        if (!lock) throw new Error('此任务正在另一窗口训练，请关闭该窗口后重新进入')
        const run = await db.trainingRuns.get(context.sessionId)
        if (cancelled) return
        if (!run) throw new Error('本机任务记录缺失，请返回首页重新读取')
        if (isRunEnded(run)) throw new Error('本轮已经结束，请返回首页查看结果或重新训练')
        setRestored(run.snapshot)
        setError('')
        setReady(context.sessionId)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
    }
    void acquire().catch((err) => {
      if (!cancelled) setError(String(err))
    })
    return () => {
      cancelled = true
      release?.()
    }
  }, [context?.sessionId])
  if (!context) return <>{children()}</>
  if (error)
    return (
      <div className="p-10">
        <p role="alert">{error}</p>
        <Link className="text-indigo-600" to="/gallery">
          返回首页
        </Link>
      </div>
    )
  return ready === context.sessionId ? <>{children(restored)}</> : <p className="p-10">正在恢复 GPT 训练…</p>
}

export function useTrainingPersistence(context: TrainingContext | undefined, state: TypingState) {
  const latest = useRef(state)
  latest.current = state
  const [error, setError] = useState('')
  useEffect(() => {
    if (!context) return
    let pending: Promise<unknown> = Promise.resolve()
    const save = (pause = false) => {
      const snapshot = structuredClone(latest.current)
      if (snapshot.spellingSession.id !== context.sessionId) return
      pending = pending
        .catch(() => undefined)
        .then(() => saveTrainingProgress(context, snapshot, pause))
        .then(() => setError(''))
        .catch((err) => setError(`训练进度未保存，正在重试：${String(err)}`))
    }
    const timer = window.setInterval(() => save(), 2000)
    const unregisterClosePreparation = registerAnalysisClosePreparation(async () => {
      await pending.catch(() => undefined)
      const snapshot = structuredClone(latest.current)
      if (snapshot.spellingSession.id === context.sessionId) await saveTrainingProgress(context, snapshot, true)
    })
    const pause = () => save(true)
    window.addEventListener('blur', pause)
    window.addEventListener('pagehide', pause)
    return () => {
      clearInterval(timer)
      unregisterClosePreparation()
      window.removeEventListener('blur', pause)
      window.removeEventListener('pagehide', pause)
      save(true)
    }
  }, [context?.sessionId])
  useEffect(() => {
    if (context && state.isFinished && !state.isSavingRecord) {
      void saveTrainingProgress(context, structuredClone(state))
        .then(() => setError(''))
        .catch((err) => setError(String(err)))
    }
  }, [context?.sessionId, state.isFinished, state.isSavingRecord])
  return error
}

export function TrainingResult({ context, state }: { context: TrainingContext; state: TypingState }) {
  const run = useLiveQuery(() => db.trainingRuns.get(context.sessionId), [context.sessionId])
  const [error, setError] = useState('')
  const result = run?.result
  const saved = run && isRunEnded(run)
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white p-8 dark:bg-gray-900" data-testid="gpt-training-result">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold">{context.task.title}</h1>
        <p className="my-4 text-lg">
          {!saved ? '正在保存训练结果…' : result?.entireTaskCompleted ? '整个任务已完成' : '本轮已结束，仍有未完成事项'}
        </p>
        <p className="text-sm text-gray-500">
          计划 {context.task.planId} · 任务 {context.task.taskId}
        </p>
        {saved && (
          <p className="my-3">
            主轮 {result?.items.filter((item) => item.mainCompleted).length}/{context.task.items.length} · 用时 {state.timerData.time} 秒 ·{' '}
            {result?.retryQueueResolved ? '复练无遗留' : '有跳过或未完成的复练，已写入结果'}
          </p>
        )}
        {result && (
          <div className="my-5 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>单词 / 词库</th>
                  <th>首次正确</th>
                  <th>尝试正确率</th>
                  <th>有效耗时</th>
                  <th>复练次数</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.itemId} className="border-t">
                    <td className="py-2">
                      {item.word}
                      <span className="block text-xs text-gray-500">
                        {item.dictionaryId}
                        {!item.mainCompleted ? ' · 主轮未完成' : ''}
                        {item.retryDeferred ? ' · 复练遗留' : ''}
                      </span>
                    </td>
                    <td>{item.firstAttemptCorrect === null ? '—' : item.firstAttemptCorrect ? '是' : '否'}</td>
                    <td>{item.attemptAccuracy === null ? '—' : `${Math.round(item.attemptAccuracy * 100)}%`}</td>
                    <td>{(item.activeDurationMs / 1000).toFixed(2)} 秒</td>
                    <td>{item.retryCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!saved && (
          <button
            className="my-btn-primary"
            onClick={() => void saveTrainingProgress(context, structuredClone(state)).catch((err) => setError(String(err)))}
          >
            重试保存
          </button>
        )}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {saved && (
          <>
            <p className="my-3 text-sm text-gray-500">结果已保存在本机，云盘写入通过队列重试。Google Drive 的上传由桌面同步程序处理。</p>
            <Link className="my-btn-primary" to="/gallery">
              返回首页
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
