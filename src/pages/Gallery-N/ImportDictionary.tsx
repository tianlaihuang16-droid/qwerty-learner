import { importLocalDictionary } from '@/utils/localDictionaries'
import { useRef, useState } from 'react'

export default function ImportDictionary() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function onFile(file: File) {
    setBusy(true)
    setMessage('正在检查并保存辞书…')
    try {
      const saved = await importLocalDictionary(file)
      setMessage(`已导入 ${saved.name}（${saved.length} 词）`)
      window.location.reload()
    } catch (error) {
      setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="my-btn-primary disabled:opacity-50" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? '导入中…' : '导入辞书'}
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".json,application/json"
        aria-label="选择 JSON 辞书"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void onFile(file)
        }}
      />
      {message && <span role="status" className="text-sm text-gray-600 dark:text-gray-300">{message}</span>}
    </div>
  )
}
