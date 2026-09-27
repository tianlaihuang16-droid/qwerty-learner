import { useEffect, useState } from 'react'

export const OPEN_USAGE_GUIDE_EVENT = 'qwerty-open-usage-guide'
const SEEN_KEY = 'qwerty-web-usage-guide:v2'

const dictionaryExample = `[
  { "name": "environment", "trans": ["环境"], "usphone": "ɪnˈvaɪrənmənt" },
  { "name": "spelling", "trans": ["拼写"] }
]`

const analysisPrompt = `请分析我从 Qwerty Learner 导出的学习数据。先说明你实际读到了哪些表和字段，再在 data.data 中查找 tableName 为 wordRecords 的 rows，按词统计练习次数、错误次数和近期表现。chapterRecords 可辅助分析批次；reviewRecords 是复习队列，不要算作已完成的练习。请列出最需要练的拼写和依据，区分记忆问题与拼写错误。缺失的字段写“未记录”，不要猜测，也不要修改原始备份。`

function hasSeenGuide() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'yes'
  } catch {
    return false
  }
}

export default function UsageGuide() {
  const [open, setOpen] = useState(() => !hasSeenGuide())
  const [page, setPage] = useState<0 | 1>(0)

  useEffect(() => {
    const show = () => { setPage(0); setOpen(true) }
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
      <section role="dialog" aria-modal="true" aria-labelledby="usage-guide-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-gray-800 shadow-2xl dark:bg-gray-800 dark:text-gray-100">
        <p className="text-xs text-indigo-500">使用说明 {page + 1} / 2</p>
        <h2 id="usage-guide-title" className="mt-2 text-2xl font-semibold">{page === 0 ? '欢迎使用 Qwerty Learner 网页版' : '辞书格式与 GPT 解读'}</h2>
        {page === 0 ? (
          <div className="mt-5 space-y-4 text-sm leading-6">
            <p>这是听读音、拼写单词的练习页。先在「词书」页试用 CET-4 演示词书，或导入自己的英文辞书，再选择词书开始练习。</p>
            <ol className="list-decimal space-y-2 pl-6">
              <li>听到读音后输入完整单词；读音按钮可以重播。读音需要联网，若整组提示无读音可点「重试读音」或关闭发音继续练习。</li>
              <li>电脑上可用键盘输入；手机上点「开始」后，点单词下方的输入框唤出键盘。拼写错误会记录为 Again；完成上一词后可用左箭头评 Easy、右箭头评 Hard，或点页面按钮；误触可用「手滑」修正最近一次错误。</li>
              <li>学习记录和自定义辞书保存在当前浏览器。清除网站数据、换浏览器或换设备前，在练习页「设置 → 数据设置」导出学习记录，并单独保存原始辞书 JSON。</li>
            </ol>
            <p>网页版没有账户同步。学习备份不会自动传到 GitHub；换设备时先导入原辞书，再导入学习备份。</p>
          </div>
        ) : (
          <div className="mt-5 space-y-4 text-sm leading-6">
            <div>
              <h3 className="font-semibold">1. 导入辞书 JSON</h3>
              <p>在「词书」页点击「导入辞书」，选择 UTF-8 编码的 .json 文件。文件顶层可以是单词数组，也可以是含 <code>words</code> 数组的对象；每项必须有非空的 <code>name</code>。<code>trans</code> 可写释义字符串或数组，<code>usphone</code>、<code>ukphone</code> 可选。单个文件不超过 10 MB、50000 词。示例：</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-900">{dictionaryExample}</pre>
              <p className="mt-2">导入后的辞书只在当前浏览器使用；学习数据备份不包含这份 JSON。</p>
            </div>
            <div>
              <h3 className="font-semibold">2. 导出并请 GPT 分析</h3>
              <ol className="list-decimal pl-6">
                <li>在练习页打开「设置 → 数据设置 → 导出数据」，下载 .gz 备份。保留原文件，用于日后在同一设置页恢复。</li>
                <li>另复制一份 .gz 并解压为 .json；若 ChatGPT 无法读取 .gz，就上传解压后的 JSON。上传前留意其中的学习时间、输入和错误记录。</li>
                <li>把下面的提问连同文件交给 GPT，并核对它报告的表与记录数；结论只作学习建议。</li>
              </ol>
              <div className="mt-2 select-text rounded-lg bg-gray-100 p-3 text-xs leading-5 dark:bg-gray-900">{analysisPrompt}</div>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {page === 1 && <button type="button" onClick={() => setPage(0)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-500">上一页</button>}
          {page === 0 ? <button type="button" onClick={() => setPage(1)} className="my-btn-primary">下一页</button> : <button type="button" onClick={dismiss} className="my-btn-primary">开始使用</button>}
        </div>
      </section>
    </div>
  )
}
