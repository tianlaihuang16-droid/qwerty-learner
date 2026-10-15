import { TypingContext } from '../../store'
import CurrentWordFsrs from './CurrentWordFsrs'
import InfoBox from './InfoBox'
import TodayReviewProgress from './TodayReviewProgress'
import { useContext } from 'react'

export default function Speed() {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const seconds = state.timerData.time % 60
  const minutes = Math.floor(state.timerData.time / 60)
  const secondsString = seconds < 10 ? '0' + seconds : seconds + ''
  const minutesString = minutes < 10 ? '0' + minutes : minutes + ''
  const inputNumber = state.chapterData.correctCount + state.chapterData.wrongCount

  return (
    <div data-testid="typing-speed" className="my-card grid w-4/5 grid-cols-2 gap-y-5 rounded-xl bg-white p-4 py-10 transition-colors duration-300 sm:grid-cols-4 xl:grid-cols-8 dark:bg-gray-800">
      <InfoBox info={`${minutesString}:${secondsString}`} description="时间" />
      <InfoBox info={inputNumber + ''} description="输入数" />
      <InfoBox info={state.timerData.wpm + ''} description="WPM" />
      <TodayReviewProgress />
      <InfoBox info={state.timerData.accuracy + ''} description="正确率" />
      <CurrentWordFsrs />
    </div>
  )
}
