import DictDetail from './DictDetail'
import DictionaryProgress from './DictionaryProgress'
import { useDictionaryLearningProgress } from './hooks/useDictionaryLearningProgress'
import bookCover from '@/assets/book-cover.png'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useIntersectionObserver from '@/hooks/useIntersectionObserver'
import { currentDictIdAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'

interface Props {
  dictionary: Dictionary
}

export default function DictionaryComponent({ dictionary }: Props) {
  const currentDictID = useAtomValue(currentDictIdAtom)

  const divRef = useRef<HTMLDivElement>(null)
  const entry = useIntersectionObserver(divRef, {})
  const isVisible = !!entry?.isIntersecting
  const learningProgress = useDictionaryLearningProgress(dictionary, isVisible)
  const isSelected = currentDictID === dictionary.id

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div
          ref={divRef}
          className={`group flex min-h-40 w-full min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg p-4 text-left shadow-lg focus:outline-none ${
            isSelected ? 'bg-indigo-400' : 'bg-zinc-50 hover:bg-white dark:bg-gray-800 dark:hover:bg-gray-700'
          }`}
          role="button"
          // onClick={onClick}
        >
          <div className="relative ml-1 flex h-full min-w-0 w-full flex-col items-start justify-start">
            <h1
              className={`mb-1.5 line-clamp-2 min-h-[3.5rem] break-words pr-20 text-xl font-normal leading-7 ${
                isSelected ? 'text-white' : 'text-gray-800 group-hover:text-indigo-400 dark:text-gray-200'
              }`}
            >
              {dictionary.name}
            </h1>
            <TooltipProvider>
              <Tooltip delayDuration={400}>
                <TooltipTrigger asChild>
                  <p
                    className={`mb-1 w-full truncate pr-20 text-sm ${
                      isSelected ? 'text-white' : 'text-gray-600 dark:text-gray-200'
                    } whitespace-nowrap`}
                  >
                    {dictionary.description}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{`${dictionary.description}`}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <p className={`mb-0.5 font-bold  ${isSelected ? 'text-white' : 'text-gray-600 dark:text-gray-200'}`}>{dictionary.length} 词</p>
            <div className="mt-auto flex w-full min-w-0 items-center pt-2">
              {(learningProgress.status === 'idle' || learningProgress.status === 'loading') && (
                <div className="h-2 w-[calc(100%-5rem)] animate-pulse rounded-full bg-slate-200 dark:bg-slate-600" aria-label="正在加载学习进度" />
              )}
              {learningProgress.status === 'ready' && <DictionaryProgress progress={learningProgress.progress} variant="card" />}
              {learningProgress.status === 'error' && <span className="text-xs text-gray-500">进度暂不可用</span>}
              <img
                src={bookCover}
                alt=""
                className={`pointer-events-none absolute right-3 top-3 w-16 ${isSelected ? 'opacity-50' : 'opacity-20'}`}
              />
            </div>
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="w-[min(60rem,calc(100vw-2rem))] max-w-none !rounded-[20px]">
        <DictDetail dictionary={dictionary} />
      </DialogContent>
    </Dialog>
  )
}
