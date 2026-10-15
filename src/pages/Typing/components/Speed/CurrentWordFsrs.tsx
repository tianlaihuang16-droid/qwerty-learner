import { TypingContext } from '../../store'
import InfoBox from './InfoBox'
import { currentDictIdAtom } from '@/store'
import { spacedReviewDb } from '@/utils/db'
import { getFsrsMemoryMetrics } from '@/utils/db/spaced-repetition'
import { FSRS_PARAMETERS_EVENT } from '@/utils/db/fsrs-parameters'
import { spacedReviewIdentity, wordLearningStateKey } from '@/utils/db/word-learning-identity'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useContext, useEffect, useState } from 'react'

export default function CurrentWordFsrs() {
  const [, refreshParameters] = useState(0)
  useEffect(() => {
    const refresh = () => refreshParameters(value => value + 1)
    window.addEventListener(FSRS_PARAMETERS_EVENT, refresh)
    return () => window.removeEventListener(FSRS_PARAMETERS_EVENT, refresh)
  }, [])
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const dictId = useAtomValue(currentDictIdAtom)
  const word = state.chapterData.words[state.chapterData.index]
  const sourceDict = word?.sourceDict ?? dictId
  const snapshot = useLiveQuery(async () => ({
    sourceDict,
    wordName: word?.name,
    record: word ? await spacedReviewDb.wordStates.get(wordLearningStateKey(spacedReviewIdentity(sourceDict, word.name))) : undefined,
  }), [sourceDict, word?.name])
  const current = snapshot?.sourceDict === sourceDict && snapshot.wordName === word?.name ? snapshot : undefined
  const metrics = current?.record ? getFsrsMemoryMetrics(current.record) : null
  const empty = !word ? '—' : !current ? '读取中' : !current.record ? '未学习' : '待更新'

  return (
    <>
      <InfoBox info={metrics?.retrievability == null ? empty : `${(metrics.retrievability * 100).toFixed(1)}%`}
        description="可回忆概率" title="当前单词的 FSRS 预测可回忆概率，不是本轮正确率；切换单词时按当前时间计算。" />
      <InfoBox info={metrics ? `${metrics.difficulty.toFixed(1)} / 10` : empty}
        description="FSRS 难度" title="当前单词的 FSRS 难度，1–10，数值越高越难。" />
      <InfoBox info={metrics ? `${metrics.stability.toFixed(2)} 天` : empty}
        description="FSRS 稳定性" title="当前单词的 FSRS 稳定性：预测可回忆概率下降至 90% 所需的时间，不等于下一次复习间隔。" />
    </>
  )
}
