import DictionaryGroup from './CategoryDicts'
import ImportDictionary from './ImportDictionary'
import TodaySpacedReviewCard from './TodaySpacedReviewCard'
import Layout from '@/components/Layout'
import { OPEN_USAGE_GUIDE_EVENT } from '@/components/UsageGuide'
import PracticeActivity from '@/pages/Typing/components/PracticeActivity'
import { dictionaries } from '@/resources/dictionary'
import { currentDictInfoAtom } from '@/store'
import type { Dictionary, LanguageCategoryType } from '@/typings'
import groupBy, { groupByDictTags } from '@/utils/groupBy'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtomValue } from 'jotai'
import { createContext, useCallback, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import type { Updater } from 'use-immer'
import { useImmer } from 'use-immer'
import IconInfo from '~icons/ic/outline-info'
import IconX from '~icons/tabler/x'

export type GalleryState = {
  currentLanguageTab: LanguageCategoryType
}

const initialGalleryState: GalleryState = {
  currentLanguageTab: 'en',
}

export const GalleryContext = createContext<{
  state: GalleryState
  setState: Updater<GalleryState>
} | null>(null)

export default function GalleryPage() {
  const [galleryState, setGalleryState] = useImmer<GalleryState>(initialGalleryState)
  const navigate = useNavigate()
  const currentDictInfo = useAtomValue(currentDictInfoAtom)

  const { groupedByCategoryAndTag } = useMemo(() => {
    const currentLanguageCategoryDicts = dictionaries.filter((dict) => dict.languageCategory === galleryState.currentLanguageTab)
    const groupedByCategory = Object.entries(groupBy(currentLanguageCategoryDicts, (dict) => dict.category))
    const groupedByCategoryAndTag = groupedByCategory.map(
      ([category, dicts]) => [category, groupByDictTags(dicts)] as [string, Record<string, Dictionary[]>],
    )

    return {
      groupedByCategoryAndTag,
    }
  }, [galleryState.currentLanguageTab])

  const onBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  useHotkeys('enter,esc', onBack, { preventDefault: true })

  useEffect(() => {
    if (currentDictInfo) {
      setGalleryState((state) => {
        state.currentLanguageTab = currentDictInfo.languageCategory
      })
    }
  }, [currentDictInfo, setGalleryState])

  return (
    <Layout>
      <GalleryContext.Provider value={{ state: galleryState, setState: setGalleryState }}>
        <div className="relative mb-auto mt-auto flex w-full min-w-0 flex-1 flex-col overflow-y-auto px-3 sm:px-6 md:px-12 xl:px-20">
          <IconX className="absolute right-6 top-10 mr-2 h-7 w-7 cursor-pointer text-gray-400 md:right-12 xl:right-20" onClick={onBack} />
          <div className="mt-10 flex w-full flex-1 flex-col items-center justify-center overflow-y-auto sm:mt-20">
            <div className="flex h-full w-full max-w-[100rem] flex-col overflow-y-auto">
              <div className="flex min-h-20 w-full flex-wrap items-center justify-between gap-3 pb-6">
                <h1 className="text-xl font-semibold text-gray-700 dark:text-gray-200">词书</h1>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="text-sm text-indigo-600 underline dark:text-indigo-300" onClick={() => window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT))}>使用说明</button>
                  <ImportDictionary />
                </div>
              </div>
              <ScrollArea.Root className="flex-1 overflow-y-auto">
                <ScrollArea.Viewport className="h-full w-full ">
                  <div className="mb-10 flex w-full justify-center">
                    <PracticeActivity />
                  </div>
                  <div className="flex w-full min-w-0 flex-1 flex-col items-stretch justify-start gap-14 overflow-y-auto">
                    {galleryState.currentLanguageTab === 'en' && (
                      <>
                        <TodaySpacedReviewCard />
                      </>
                    )}
                    {groupedByCategoryAndTag.map(([category, groupeByTag]) => (
                      <DictionaryGroup key={category} groupedDictsByTag={groupeByTag} />
                    ))}
                  </div>
                  <div className="flex items-center justify-center pb-10 pt-[20rem] text-gray-500">
                    <IconInfo className="mr-1 h-5 w-5" />
                    <p className="mr-5 w-10/12 text-xs">
                      程序代码按 GPL-3.0 开源。内置 CET-4 词书仅供学习演示；其词典及音标数据来自第三方，本项目不代表原权利人授予额外的商业使用许可。商业使用演示词书前，请先核实原始数据的授权。自行导入词书的使用权限由您确认。
                      如果您是数据权利人并认为这里的使用侵犯了您的权利，请通过 <a href="https://github.com/tianlaihuang16-droid/qwerty-learner/issues" target="_blank" rel="noreferrer" className="underline">GitHub Issues</a> 联系我们。
                    </p>
                  </div>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
              </ScrollArea.Root>
              {/* todo: 增加导航 */}
              {/* <div className="mt-20 h-40 w-40 text-center ">
                <CategoryNavigation />
              </div> */}
            </div>
          </div>
        </div>
      </GalleryContext.Provider>
    </Layout>
  )
}
