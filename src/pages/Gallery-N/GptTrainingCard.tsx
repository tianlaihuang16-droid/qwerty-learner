import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import { isRunEnded, listTrainingTasks, startTrainingTask } from '@/utils/db/training-service'
import type { TaskEntry } from '@/utils/db/training-service'
import { trainingDate, trainingSources } from '@/utils/gptTraining'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function GptTrainingCard() {
  const [entries, setEntries] = useState<TaskEntry[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const setReview = useSetAtom(reviewModeInfoAtom)
  const setDict = useSetAtom(currentDictIdAtom)
  const setChapter = useSetAtom(currentChapterAtom)
  const navigate = useNavigate()
  const refresh = useCallback(() => {
    void listTrainingTasks()
      .then((result) => {
        setEntries(result.entries)
        setErrors(result.errors)
      })
      .catch((error) => setErrors([String(error)]))
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  const start = async (entry: TaskEntry) => {
    setBusy(true)
    try {
      const record = await startTrainingTask(entry.task, !!entry.run && isRunEnded(entry.run))
      if (record.words[0]?.sourceDict) setDict(record.words[0].sourceDict)
      setChapter(-1)
      setReview({ isReviewMode: true, reviewRecord: record })
      navigate('/')
    } catch (error) {
      setErrors([String(error)])
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="mb-4 w-full min-w-0 rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-gray-800"
      data-testid="gpt-training-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-indigo-600 dark:text-indigo-300">GPT 今日训练</h2>
        <button className="my-btn-secondary" disabled={busy} onClick={refresh}>
          刷新任务
        </button>
      </div>
      {!entries.length && (
        <p className="mt-3 text-sm text-gray-500">暂无任务。将 GPT 生成的任务 JSON 放入云盘 words/training-tasks 后刷新。</p>
      )}
      {entries.map((entry) => {
        const ended = !!entry.run && isRunEnded(entry.run)
        const future = entry.task.scheduledDate > trainingDate()
        const result = entry.run?.result
        return (
          <div key={entry.task.taskId} className="mt-3 rounded-lg bg-white p-4 dark:bg-gray-900">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="break-words font-semibold">{entry.task.title}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {entry.task.scheduledDate} · {entry.task.items.length} 词 ·{' '}
                  {Array.from(new Set(entry.task.items.map((item) => trainingSources[item.sourceType]))).join(' / ')}
                </p>
                <p className="text-sm">
                  {entry.run?.status === 'completed'
                    ? '整个任务已完成'
                    : ended
                    ? '本轮已结束，仍有未完成事项'
                    : entry.run
                    ? '可继续训练'
                    : future
                    ? '尚未到训练日期'
                    : '待开始'}
                  {result && ` · 已完成主轮 ${result.items.filter((item) => item.mainCompleted).length}/${entry.task.items.length}`}
                </p>
              </div>
              <button
                className="my-btn-primary"
                disabled={busy || future || (!!entry.error && (!entry.run || ended))}
                onClick={() => void start(entry)}
              >
                {ended ? '重新训练' : entry.run ? '继续训练' : '开始训练'}
              </button>
            </div>
            {entry.error && (
              <p role="alert" className="mt-2 text-sm text-amber-700">
                {entry.error}
              </p>
            )}
            {entry.notice && <p className="mt-2 text-sm text-indigo-600 dark:text-indigo-300">{entry.notice}</p>}
            {result && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer">查看本次结果</summary>
                <p>
                  主轮：{result.mainListCompleted ? '完成' : '未完成'} · 重练：{result.retryQueueResolved ? '无遗留' : '有遗留'}
                </p>
                <p>
                  计划：{entry.task.planId} · 任务：{entry.task.taskId}
                </p>
              </details>
            )}
          </div>
        )
      })}
      {errors.map((error, index) => (
        <p key={index} role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ))}
    </section>
  )
}
