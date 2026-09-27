import styles from './index.module.css'
import type { ExportProgress, ImportProgress } from '@/utils/db/data-export'
import { exportDatabase, importDatabase } from '@/utils/db/data-export'
import * as Progress from '@radix-ui/react-progress'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useCallback, useRef, useState } from 'react'

export default function DataSetting() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportMessage, setExportMessage] = useState('')

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importMessage, setImportMessage] = useState('')
  const importInput = useRef<HTMLInputElement>(null)

  const exportProgressCallback = useCallback(({ totalRows, completedRows, done }: ExportProgress) => {
    if (done) {
      setExportProgress(100)
      return true
    }
    if (totalRows) {
      setExportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onClickExport = useCallback(async () => {
    setExportProgress(0)
    setExportMessage('')
    setIsExporting(true)
    try {
      const result = await exportDatabase(exportProgressCallback)
      if (result.status === 'cancelled') {
        setExportProgress(0)
        setExportMessage('已取消保存')
      } else {
        setExportMessage(result.path ? `已保存到：${result.path}` : '数据已导出')
      }
    } catch (error) {
      console.error('Failed to export user data', error)
      setExportMessage('保存失败，请重新选择保存位置后再试')
    } finally {
      setIsExporting(false)
    }
  }, [exportProgressCallback])

  const importProgressCallback = useCallback(({ totalRows, completedRows, done }: ImportProgress) => {
    if (done) {
      setIsImporting(false)
      setImportProgress(100)
      return true
    }
    if (totalRows) {
      setImportProgress(Math.floor((completedRows / totalRows) * 100))
    }

    return true
  }, [])

  const onImportFile = useCallback(
    async (file: File) => {
      setImportProgress(0)
      setIsImporting(true)
      setImportMessage('正在检查备份…')
      try {
        await importDatabase(file, importProgressCallback)
        window.location.reload()
      } catch (error) {
        setImportMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setIsImporting(false)
      }
    },
    [importProgressCallback],
  )

  const onClickImport = useCallback(() => {
    importInput.current?.click()
  }, [])

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>网页版本地数据</span>
            <span className={styles.sectionDescription}>学习记录保存在当前浏览器中。请定期使用下方按钮导出备份；更换浏览器或清除网站数据前先备份。</span>
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导出</span>
            <span className={styles.sectionDescription}>
              备份包含学习记录、续练进度和练习设置。恢复后会根据学习历史重新生成复习计划。
              网页版不提供桌面云盘同步；自定义词库文件请另行保留。
            </span>
            <span className="pl-4 text-left text-sm font-bold leading-tight text-red-500">
              为了您的数据安全，请不要修改导出的数据文件。
            </span>
            <span className="pl-4 text-left text-sm leading-tight text-gray-600">
              浏览器会将导出的备份下载到你的默认下载位置。
            </span>
            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={exportProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - exportProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${exportProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickExport}
              disabled={isExporting || isImporting}
              title="导出数据"
            >
              导出数据
            </button>
            {exportMessage && <span className="pl-4 text-left text-sm leading-tight text-gray-600">{exportMessage}</span>}
          </div>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>数据导入</span>
            <span className={styles.sectionDescription}>
              导入将<strong className="text-sm font-bold text-red-500">覆盖当前学习记录</strong>，并恢复备份中的进度和设置。 兼容旧版 .gz
              备份；旧备份不含设置，导入时保留当前设置并清除旧续练快照。完成后会自动重新打开。
            </span>

            <div className="flex h-3 w-full items-center justify-start px-5">
              <Progress.Root
                className="translate-z-0 relative h-2 w-11/12 transform  overflow-hidden rounded-full bg-gray-200"
                value={importProgress}
              >
                <Progress.Indicator
                  className="cubic-bezier(0.65, 0, 0.35, 1) h-full w-full bg-indigo-400 transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${100 - importProgress}%)` }}
                />
              </Progress.Root>
              <span className="ml-4 w-10 text-xs font-normal text-gray-600">{`${importProgress}%`}</span>
            </div>

            <button
              className="my-btn-primary ml-4 disabled:bg-gray-300"
              type="button"
              onClick={onClickImport}
              disabled={isImporting || isExporting}
              title="导入数据"
            >
              导入数据
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".gz,application/gzip,application/x-gzip"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) void onImportFile(file)
              }}
            />
            {importMessage && (
              <span role="status" className="pl-4 text-left text-sm text-gray-600">
                {importMessage}
              </span>
            )}
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
