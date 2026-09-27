type DictionaryCompleteStateProps = {
  allLearned: boolean
  onReturnToDictionary: () => void
}

export default function DictionaryCompleteState({ allLearned, onReturnToDictionary }: DictionaryCompleteStateProps) {
  return (
    <div
      className="flex max-w-lg flex-col items-center gap-5 rounded-2xl bg-indigo-50 px-10 py-8 text-center dark:bg-indigo-950/40"
      data-testid="dictionary-complete"
    >
      <div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
          {allLearned ? '本词书没有新词' : '本词书暂无可练习新词'}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {allLearned ? '已学词请到 FSRS 今日复习中按计划复习。' : '剩余新词已拉黑，可在设置中取消拉黑后继续学习。'}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button className="my-btn-primary" onClick={onReturnToDictionary}>
          返回词书
        </button>
      </div>
    </div>
  )
}
