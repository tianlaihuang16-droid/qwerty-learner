import type { WordUpdateAction } from '../InputHandler'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { isWholeWordSubmitAtom } from '@/store'
import { useAtomValue } from 'jotai'
import type { FormEvent } from 'react'
import { useContext, useEffect, useRef } from 'react'

export default function MobileInputHandler({ updateInput }: { updateInput: (updateObj: WordUpdateAction) => void }) {
  const { state, dispatch } = useContext(TypingContext)!
  const isWholeWordSubmit = useAtomValue(isWholeWordSubmitAtom)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!state.isTyping) inputRef.current?.blur()
  }, [state.isTyping])

  function onInput(event: FormEvent<HTMLInputElement>) {
    const input = event.nativeEvent as InputEvent
    if (!state.isTyping || input.isComposing) return
    if (input.inputType === 'deleteContentBackward') {
      if (isWholeWordSubmit) updateInput({ type: 'delete', length: 1 })
    } else if (input.data) {
      for (const character of input.data) updateInput({ type: 'add', value: character, event })
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="mx-auto mt-5 w-[min(85vw,22rem)] sm:hidden">
      <label htmlFor="mobile-spelling-input" className="mb-2 block text-center text-sm text-gray-500 dark:text-gray-300">点此输入拼写</label>
      <div className="flex gap-2">
        <input
          id="mobile-spelling-input"
          ref={inputRef}
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="输入单词拼写"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          onFocus={() => { if (!state.isTyping) dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: true }) }}
          onInput={onInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && isWholeWordSubmit) {
              event.preventDefault()
              updateInput({ type: 'submit' })
            }
          }}
        />
        {isWholeWordSubmit && <button type="button" className="my-btn-primary" onClick={() => updateInput({ type: 'submit' })}>提交</button>}
      </div>
    </div>
  )
}
