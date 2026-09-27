import { useEffect, useState } from 'react'

export const OPEN_USAGE_GUIDE_EVENT = 'qwerty-open-usage-guide'
const SEEN_KEY = 'qwerty-web-usage-guide:v1'

function hasSeenGuide() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'yes'
  } catch {
    return false
  }
}

export default function UsageGuide() {
  const [open, setOpen] = useState(() => !hasSeenGuide())

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(OPEN_USAGE_GUIDE_EVENT, show)
    return () => window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, show)
  }, [])

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, 'yes')
    } catch {
      // The guide can still be closed when browser storage is unavailable.
    }
    setOpen(false)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="usage-guide-title" className="w-full max-w-xl rounded-2xl bg-white p-6 text-gray-800 shadow-2xl dark:bg-gray-800 dark:text-gray-100">
        <h2 id="usage-guide-title" className="text-2xl font-semibold">欢迎使用 Qwerty Learner 网页版</h2>
        <ol className="mt-5 list-decimal space-y-3 pl-6 text-sm leading-6">
          <li>先试用 CET-4 演示词书；也可以在「词书」页导入自己的英文 JSON 辞书。</li>
          <li>辞书和学习记录只保存在当前浏览器，不会上传到 GitHub，也不会自动同步到其他设备。</li>
          <li>在练习页的「设置 → 数据设置」定期导出学习记录备份。备份不包含自定义辞书，原始 JSON 文件请一起保存；换设备时先导入辞书，再导入学习备份。</li>
        </ol>
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-300">辞书格式：JSON 单词数组，每项至少有 name；trans 可写释义，usphone、ukphone 可选。</p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <a href="#/gallery" onClick={dismiss} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-500">查看词书</a>
          <button type="button" onClick={dismiss} className="my-btn-primary">开始使用</button>
        </div>
      </section>
    </div>
  )
}
