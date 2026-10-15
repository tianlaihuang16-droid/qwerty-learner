import type { WordWithIndex } from '@/typings'
import { getWordFeedback, setWordBlacklisted, setWordHelpful, setWordNeedsWritingExample } from '@/utils/db/word-feedback-service'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'

type Props = {
  word: WordWithIndex
  sourceDict: string
  onSkip: () => void
}

export default function WordFeedbackControls({ word, sourceDict, onSkip }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const feedback = useLiveQuery(() => (sourceDict ? getWordFeedback(sourceDict, word.name) : undefined), [sourceDict, word.name])

  const blacklist = async () => {
    if (busy || feedback?.blacklisted) return
    setBusy(true)
    setError('')
    try {
      await setWordBlacklisted(sourceDict, word.name, true)
      onSkip()
    } catch (reason) {
      console.error('Failed to blacklist word', reason)
      setError('拉黑保存失败，当前词未跳过')
    } finally {
      setBusy(false)
    }
  }

  const toggleWritingUse = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const marked = feedback?.needsWritingExample !== true
      await setWordNeedsWritingExample(sourceDict, word.name, marked)
      if (marked) onSkip()
    } catch (reason) {
      console.error('Failed to save writing-use feedback', reason)
      setError('写作使用反馈保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const toggleHelpful = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await setWordHelpful(sourceDict, word.name, feedback?.helpful !== true)
    } catch (reason) {
      console.error('Failed to save helpful feedback', reason)
      setError('帮助反馈保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2" data-testid="word-feedback-controls">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleHelpful()}
          aria-label={feedback?.helpful ? '已标记很有帮助，点击取消' : '很有帮助'}
          aria-pressed={feedback?.helpful === true}
          title={feedback?.helpful ? '已标记很有帮助，点击取消' : '这个词很有帮助；标记后取消写作不会用'}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition disabled:cursor-wait disabled:opacity-60 ${
            feedback?.helpful
              ? 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
        >
          👍 很有帮助
        </button>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition disabled:cursor-wait disabled:opacity-60 ${
            feedback?.needsWritingExample
              ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
          disabled={busy}
          onClick={() => void toggleWritingUse()}
          aria-label={feedback?.needsWritingExample ? '已标记写作不会用，点击取消' : '想不到写作中怎么用这个词'}
          aria-pressed={feedback?.needsWritingExample === true}
          title={
            feedback?.needsWritingExample ? '已标记：想不到写作中怎么用，点击取消' : '标记写作不会用并跳过当前词；取消很有帮助，不拉黑'
          }
        >
          {feedback?.needsWritingExample ? '❓ 写作不会用' : '❓ 写作不会用并跳过'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950/30"
          disabled={busy || feedback?.blacklisted}
          onClick={() => void blacklist()}
          aria-label={feedback?.blacklisted ? '已拉黑' : '拉黑并跳过'}
        >
          {busy ? '正在拉黑…' : feedback?.blacklisted ? '已拉黑' : '拉黑并跳过'}
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
