import styles from './index.module.css'
import { clearWordBlacklist, listBlacklistedWords } from '@/utils/db/word-feedback-service'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'

export default function FeedbackSetting() {
  const blacklisted = useLiveQuery(() => listBlacklistedWords(), [], [])
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')

  const undo = async (scope: string, normalizedWord: string) => {
    const key = `${scope}\0${normalizedWord}`
    setBusyKey(key)
    setError('')
    try {
      await clearWordBlacklist(scope, normalizedWord)
    } catch (reason) {
      console.error('Failed to undo word blacklist', reason)
      setError('取消拉黑失败，请重试')
    } finally {
      setBusyKey('')
    }
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>词条反馈</span>
        <span className={styles.sectionDescription}>
          拉黑词会从后续普通学习、复习和 GPT 训练中排除，但不会删除历史练习和 FSRS 状态。“没有帮助”只记录推荐偏好，取消拉黑时仍会保留。
        </span>
        <div className="w-full space-y-2 pl-4 pr-2" data-testid="blacklist-manager">
          {blacklisted.length === 0 ? (
            <p className="text-sm text-gray-500">暂无拉黑词</p>
          ) : (
            blacklisted.map((feedback) => {
              const key = `${feedback.scope}\0${feedback.normalizedWord}`
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
                >
                  <div className="min-w-0 text-left">
                    <p className="truncate font-medium text-gray-700 dark:text-gray-200">{feedback.word}</p>
                    <p className="truncate text-xs text-gray-500">
                      {feedback.scope} · {feedback.sourceDicts.join(' / ')}
                      {feedback.notHelpfulCount > 0 ? ` · 没有帮助 ${feedback.notHelpfulCount} 次` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="my-btn-secondary shrink-0 disabled:cursor-wait disabled:opacity-60"
                    disabled={busyKey === key}
                    onClick={() => void undo(feedback.scope, feedback.normalizedWord)}
                    aria-label={`取消拉黑 ${feedback.word}`}
                  >
                    {busyKey === key ? '处理中…' : '取消拉黑'}
                  </button>
                </div>
              )
            })
          )}
        </div>
        {error && (
          <p role="alert" className="pl-4 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
