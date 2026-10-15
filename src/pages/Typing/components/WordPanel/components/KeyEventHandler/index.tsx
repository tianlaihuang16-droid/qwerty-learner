import type { WordUpdateAction } from '../InputHandler'
import { TypingContext } from '@/pages/Typing/store'
import { isWholeWordSubmitAtom } from '@/store'
import { isChineseSymbol, isLegal } from '@/utils'
import { useAtomValue } from 'jotai'
import { useCallback, useContext, useEffect } from 'react'

export default function KeyEventHandler({ updateInput, wholeWordSubmit }: { updateInput: (updateObj: WordUpdateAction) => void; wholeWordSubmit?: boolean }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const savedWholeWordSubmit = useAtomValue(isWholeWordSubmitAtom)
  const isWholeWordSubmit = wholeWordSubmit ?? savedWholeWordSubmit

  const onKeydown = useCallback(
    (e: KeyboardEvent) => {
      const char = e.key

      if (isWholeWordSubmit && char === 'Backspace') {
        e.preventDefault()
        updateInput({ type: 'delete', length: 1 })
        return
      }

      if (isWholeWordSubmit && char === ' ') {
        e.preventDefault()
        updateInput({ type: 'submit' })
        return
      }

      if (isChineseSymbol(char)) {
        alert('您正在使用输入法，请关闭输入法。')
        return
      }

      if (isLegal(char) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        updateInput({ type: 'add', value: char, event: e })
      }
    },
    [isWholeWordSubmit, updateInput],
  )

  useEffect(() => {
    if (!state.isTyping) return

    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
    }
  }, [onKeydown, state.isTyping])

  return <></>
}
