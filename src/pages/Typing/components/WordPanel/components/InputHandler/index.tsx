import KeyEventHandler from '../KeyEventHandler'
import MobileInputHandler from '../MobileInputHandler'
import TextAreaHandler from '../TextAreaHandler'
import { currentDictInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import type { FormEvent } from 'react'
import { useMemo } from 'react'

export default function InputHandler({ updateInput, wholeWordSubmit }: { updateInput: (updateObj: WordUpdateAction) => void; wholeWordSubmit?: boolean }) {
  const dictInfo = useAtomValue(currentDictInfoAtom)
  const isPhone = window.matchMedia('(max-width: 600px)').matches

  const handler = useMemo(() => {
    switch (dictInfo.language) {
      case 'en':
        return isPhone ? <MobileInputHandler updateInput={updateInput} wholeWordSubmit={wholeWordSubmit} /> : <KeyEventHandler updateInput={updateInput} wholeWordSubmit={wholeWordSubmit} />
      case 'de':
        return isPhone ? <MobileInputHandler updateInput={updateInput} wholeWordSubmit={wholeWordSubmit} /> : <KeyEventHandler updateInput={updateInput} wholeWordSubmit={wholeWordSubmit} />
      case 'romaji':
        return <KeyEventHandler updateInput={updateInput} wholeWordSubmit={wholeWordSubmit} />
      case 'code':
        return <TextAreaHandler updateInput={updateInput} />
      default:
        return <TextAreaHandler updateInput={updateInput} />
    }
  }, [dictInfo.language, isPhone, updateInput, wholeWordSubmit])

  return <>{handler}</>
}
export type WordUpdateAction = WordAddAction | WordDeleteAction | WordSubmitAction | WordCompositionAction

export type WordAddAction = {
  type: 'add'
  value: string
  event: FormEvent<HTMLTextAreaElement> | FormEvent<HTMLInputElement> | KeyboardEvent
}

export type WordDeleteAction = {
  type: 'delete'
  length: number
}

export type WordSubmitAction = {
  type: 'submit'
}

// composition api is not ready yet
export type WordCompositionAction = {
  type: 'composition'
  value: string
}
