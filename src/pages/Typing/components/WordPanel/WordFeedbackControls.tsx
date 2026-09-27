import type { WordWithIndex } from '@/typings'
import { getWordFeedback, markWordNotHelpful, setWordBlacklisted } from '@/utils/db/word-feedback-service'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'

type Props = {
  word: WordWithIndex
  sourceDict: string
  onBlacklisted: () => void
}

export default function WordFeedbackControls({ word, sourceDict, onBlacklisted }: Props) {
  const [busy, setBusy] = useState<'blacklist' | 'not-helpful'>()
  const [error, setError] = useState('')
  const feedback = useLiveQuery(() => (sourceDict ? getWordFeedback(sourceDict, word.name) : undefined), [sourceDict, word.name])
  const notHelpfulLabel = useMemo(
    () => (feedback?.notHelpfulCount ? `已记录没有帮助 ${feedback.notHelpfulCount} 次` : '没有帮助'),
    [feedback?.notHelpfulCount],
  )

  const markNotHelpful = async () => {
    if (busy) return
    setBusy('not-helpful')
    setError('')
    try {
      await markWordNotHelpful(sourceDict, word.name)
    } catch (reason) {
      console.error('Failed to mark word as not helpful', reason)
      setError('反馈保存失败，请重试')
    } finally {
      setBusy(undefined)
    }
  }

  const blacklist = async () => {
    if (busy || feedback?.blacklisted) return
    setBusy('blacklist')
    setError('')
    try {
      await setWordBlacklisted(sourceDict, word.name, true)
      onBlacklisted()
    } catch (reason) {
      console.error('Failed to blacklist word', reason)
      setError('拉黑保存失败，当前词未跳过')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2" data-testid="word-feedback-controls">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-wait disabled:opacity-60 dark:border-gray-600 dark:text-gray-300"
          disabled={Boolean(busy)}
          onClick={() => void markNotHelpful()}
          aria-label={notHelpfulLabel}
        >
          {busy === 'not-helpful' ? '正在记录…' : notHelpfulLabel}
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950/30"
          disabled={Boolean(busy) || feedback?.blacklisted}
          onClick={() => void blacklist()}
          aria-label={feedback?.blacklisted ? '已拉黑' : '拉黑并跳过'}
        >
          {busy === 'blacklist' ? '正在拉黑…' : feedback?.blacklisted ? '已拉黑' : '拉黑并跳过'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
