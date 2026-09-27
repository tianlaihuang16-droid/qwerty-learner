import Loading from './components/Loading'
import UsageGuide from './components/UsageGuide'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import { DATA_RESTORE_EVENT } from '@/utils/db/maintenance'
import { loadLocalDictionaries } from '@/utils/localDictionaries'
import { flushAlgorithmReviewPlan, initializeSpacedReviewSchedule } from '@/utils/db/spaced-review-service'
import 'animate.css'
import { useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

const AnalysisPage = lazy(() => import('./pages/Analysis'))
const GalleryPage = lazy(() => import('./pages/Gallery-N'))

function Root() {
  const [restoreStatus, setRestoreStatus] = useState<{ message: string; failed?: boolean }>()
  useEffect(() => {
    const onRestore = (event: Event) => setRestoreStatus((event as CustomEvent).detail)
    window.addEventListener(DATA_RESTORE_EVENT, onRestore)
    return () => window.removeEventListener(DATA_RESTORE_EVENT, onRestore)
  }, [])
  const darkMode = useAtomValue(isOpenDarkModeAtom)
  useEffect(() => {
    darkMode ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')
  }, [darkMode])

  if (restoreStatus) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center dark:text-white" role="status">
        <p>{restoreStatus.message}</p>
        {restoreStatus.failed && (
          <button className="my-btn-primary" onClick={() => window.location.reload()}>
            重新打开
          </button>
        )}
      </div>
    )
  }

  return (
    <React.StrictMode>
      <HashRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<TypingPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/error-book" element={<ErrorBook />} />
            <Route path="/mobile" element={<Navigate to="/" replace />} />
            <Route path="/*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
        <UsageGuide />
      </HashRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

async function startApp() {
  appRoot?.render(<Loading />)
  try {
    await loadLocalDictionaries()
  } catch (error) {
    console.error('Failed to load local dictionaries', error)
  }
  try {
    await initializeSpacedReviewSchedule()
  } catch (error) {
    console.error('Failed to initialize spaced review', error)
    const message = error instanceof Error ? error.message : String(error)
    document.title = `Qwerty Learner | 同步初始化失败：${message.slice(0, 120)}`
  }
  appRoot?.render(<Root />)
}

const appRoot = container ? createRoot(container) : undefined
window.addEventListener('pagehide', () => {
  void flushAlgorithmReviewPlan().catch(() => undefined)
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushAlgorithmReviewPlan().catch(() => undefined)
})
void startApp()
