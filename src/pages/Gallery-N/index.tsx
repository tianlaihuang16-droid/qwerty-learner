import DictionaryGroup from './CategoryDicts'
import GalleryLearningDashboard from './GalleryLearningDashboard'
import ImportDictionary from './ImportDictionary'
import { OPEN_USAGE_GUIDE_EVENT } from '@/components/UsageGuide'
import TodaySpacedReviewCard from './TodaySpacedReviewCard'
import './gallery.css'
import { useGalleryLearningSnapshot } from './hooks/useGalleryLearningSnapshot'
import Layout from '@/components/Layout'
import { dictionaries } from '@/resources/dictionary'
import { currentDictInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import groupBy, { groupByDictTags } from '@/utils/groupBy'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

export default function GalleryPage() {
  const learning = useGalleryLearningSnapshot()
  const navigate = useNavigate()
  const currentDictInfo = useAtomValue(currentDictInfoAtom)

  const groupedByCategoryAndTag = Object.entries(groupBy(dictionaries, (dict) => dict.category)).map(
    ([category, dicts]) =>
      [
        category,
        groupByDictTags(
          dicts
            .slice()
            .reverse()
            .sort((left, right) => (right.addedAt ?? 0) - (left.addedAt ?? 0)),
        ),
      ] as [string, Record<string, Dictionary[]>],
  )

  const onBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  useHotkeys('enter,esc', onBack, { preventDefault: true })

  return (
    <Layout>
      <div className="gallery-home w-full flex-1 overflow-y-auto px-5 pb-10 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1480px]">
          <header className="mb-8 flex items-center justify-between gap-4">
            <div>
              <p className="gallery-eyebrow">QWERTY LEARNER</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">你的学习空间</h1>
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">让每一次练习，都有迹可循。</p>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="gallery-back flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm"
            >
              返回练习 <IconX className="h-4 w-4" />
            </button>
          </header>
          <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
            {currentDictInfo && <GalleryLearningDashboard key={currentDictInfo.id} dictionary={currentDictInfo} learning={learning} />}
            <div className="min-w-0 space-y-6">
              {currentDictInfo.languageCategory === 'en' && <TodaySpacedReviewCard learning={learning} />}
              <section className="gallery-library rounded-2xl border p-5 sm:p-6" data-testid="gallery-dictionaries">
                <div className="mb-5 flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold">我的词书</h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="text-sm underline" onClick={() => window.dispatchEvent(new Event(OPEN_USAGE_GUIDE_EVENT))}>使用说明</button>
                    <ImportDictionary />
                  </div>
                </div>
                {groupedByCategoryAndTag.map(([category, groupeByTag]) => (
                  <DictionaryGroup key={category} groupedDictsByTag={groupeByTag} />
                ))}
              </section>

            </div>
          </div>
          <details className="mt-8 border-t border-stone-200 pt-4 text-xs leading-relaxed text-stone-500 dark:border-stone-700">
            <summary className="w-fit cursor-pointer">关于词书数据与使用说明</summary>
            <p className="mt-3 max-w-4xl">
              程序代码按 GPL-3.0 开源。内置 CET-4 词书仅供学习演示；其词典及音标数据来自第三方，本项目不代表原权利人授予额外的商业使用许可。商业使用演示词书前，请先核实原始数据的授权。自行导入词书的使用权限由您确认。
              如果您是数据权利人并认为这里的使用侵犯了您的权利，请通过 <a href="https://github.com/tianlaihuang16-droid/qwerty-learner/issues" target="_blank" rel="noreferrer" className="underline">GitHub Issues</a> 联系我们。
            </p>
          </details>
        </div>
      </div>
    </Layout>
  )
}
