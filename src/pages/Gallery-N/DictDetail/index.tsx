import DictionaryProgress from '../DictionaryProgress'
import { useDeleteWordRecord } from '../../../utils/db'
import { ErrorTable } from '../ErrorTable'
import { getRowsFromErrorWordData } from '../ErrorTable/columns'
import { ReviewDetail } from '../ReviewDetail'
import { useDictionaryLearningProgress } from '../hooks/useDictionaryLearningProgress'
import useErrorWordData from '../hooks/useErrorWords'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { generateSpacedReviewRecord, getSpacedReviewSummary } from '@/utils/db/spaced-review-service'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import IcOutlineCollectionsBookmark from '~icons/ic/outline-collections-bookmark'
import MaterialSymbolsOverviewOutlineRounded from '~icons/material-symbols/overview-outline-rounded'
import PajamasReviewList from '~icons/pajamas/review-list'

enum Tab {
  Overview = 'overview',
  Errors = 'errors',
  Review = 'review',
}

export default function DictDetail({ dictionary: dict }: { dictionary: Dictionary }) {
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const [curTab, setCurTab] = useState<Tab>(Tab.Overview)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const { deleteWordRecord } = useDeleteWordRecord()
  const [reload, setReload] = useState(false)
  const [spacedDueCount, setSpacedDueCount] = useState(0)

  const learningProgress = useDictionaryLearningProgress(dict)
  const { errorWordData, isLoading, error } = useErrorWordData(dict, reload)

  const tableData = useMemo(() => {
    return getRowsFromErrorWordData(errorWordData)
  }, [errorWordData])

  const onDelete = useCallback(
    async (word: string) => {
      await deleteWordRecord(word, dict.id)
      setReload((old) => !old)
    },
    [deleteWordRecord, dict.id],
  )

  const startLearning = useCallback(
    () => {
      setCurrentDictId(dict.id)
      setCurrentChapter(0)
      setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
      navigate('/')
    },
    [dict.id, navigate, setCurrentChapter, setCurrentDictId, setReviewModeInfo],
  )

  const startDictionarySpacedReview = useCallback(async () => {
    const reviewRecord = await generateSpacedReviewRecord(dict.id)
    if (!reviewRecord) return
    setCurrentDictId(dict.id)
    setCurrentChapter(-1)
    setReviewModeInfo({ isReviewMode: true, reviewRecord })
    navigate('/')
  }, [dict.id, navigate, setCurrentChapter, setCurrentDictId, setReviewModeInfo])

  useEffect(() => {
    if (dict.reviewScope !== 'dictionary') return
    getSpacedReviewSummary(dict.id).then(({ dueCount }) => setSpacedDueCount(dueCount))
  }, [dict.id, dict.reviewScope])

  const handleTabChange = useCallback(
    (value: Tab) => {
      if (value !== curTab) {
        setCurTab(value)
      }
    },
    [curTab],
  )

  const wordListLoaded = learningProgress.words.length > 0
  const isProgressLoading = learningProgress.status === 'idle' || learningProgress.status === 'loading'
  const isComplete = learningProgress.status === 'ready' && learningProgress.progress.unlearned === 0
  const canStart = wordListLoaded && learningProgress.status === 'ready' && !isComplete

  return (
    <div className="flex flex-col px-4 py-3 pl-5 text-gray-800 dark:text-gray-300">
      <div className="text relative flex min-h-40 flex-col gap-2 pr-4">
        <h3 className="text-2xl font-semibold">{dict.name}</h3>
        <p>共 {dict.length} 词</p>
        <p>{dict.description}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup type="single" value={curTab} onValueChange={handleTabChange}>
            <ToggleGroupItem
              value={Tab.Overview}
              disabled={curTab === Tab.Overview}
              className={`${curTab === Tab.Overview ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
            >
              <MaterialSymbolsOverviewOutlineRounded className="mr-1.5 text-gray-500" />
              整本进度
            </ToggleGroupItem>
            {errorWordData.length > 0 && (
              <>
                <ToggleGroupItem
                  value={Tab.Errors}
                  disabled={curTab === Tab.Errors}
                  className={`${curTab === Tab.Errors ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
                >
                  <IcOutlineCollectionsBookmark className="mr-1.5 text-gray-500" />
                  查看错题
                </ToggleGroupItem>
                <ToggleGroupItem
                  value={Tab.Review}
                  disabled={curTab === Tab.Review}
                  className={`${curTab === Tab.Review ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
                >
                  <PajamasReviewList className="mr-1.5 text-gray-500" />
                  错题回顾
                </ToggleGroupItem>
              </>
            )}
          </ToggleGroup>
          <Button size="sm" disabled={!canStart} onClick={startLearning}>
            继续学习新词
          </Button>
          {dict.reviewScope === 'dictionary' && (
            <Button size="sm" variant="outline" disabled={spacedDueCount === 0} onClick={startDictionarySpacedReview}>
              继续本辞书 FSRS 复习（{spacedDueCount}）
            </Button>
          )}
        </div>
      </div>
      <div className="mt-4 flex pl-0">
        <Tabs value={curTab} className="h-[26rem] w-full">
          <TabsContent value={Tab.Overview} className="h-full">
            <div className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700" data-testid="dictionary-overview">
              <h4 className="mb-4 text-lg font-medium">FSRS 复习间隔分布</h4>
              {isProgressLoading && <div className="h-3 w-full animate-pulse rounded-full bg-slate-200 dark:bg-slate-600" />}
              {learningProgress.status === 'ready' && (
                <>
                  <DictionaryProgress progress={learningProgress.progress} variant="detail" />
                  {isComplete && <p className="mt-5 text-sm font-medium text-emerald-600 dark:text-emerald-400">本词书没有新词；到期复习请进入 FSRS 今日复习。</p>}
                </>
              )}
              {learningProgress.status === 'error' && (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {wordListLoaded ? '学习状态暂不可用，暂时无法确认新词' : '词书加载失败，暂时无法开始练习'}
                </div>
              )}
              <p className="mt-6 text-sm text-gray-500">
                {dict.reviewScope === 'dictionary'
                  ? '本词书的 FSRS 复习状态独立保存，不计入全局今日复习。'
                  : '学习状态按同语言单词全局同步，在其他词书练过的单词也会计入这里。'}
              </p>
            </div>
          </TabsContent>
          <TabsContent value={Tab.Errors} className="h-full">
            <ErrorTable data={tableData} isLoading={isLoading} error={error} onDelete={onDelete} />
          </TabsContent>
          <TabsContent value={Tab.Review} className="h-full">
            <ReviewDetail errorData={errorWordData} dict={dict} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
