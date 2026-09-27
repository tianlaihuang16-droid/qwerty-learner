const EXPLICIT_SPACE = '␣'

export type WholeWordEditResult = {
  input: string
  submitted: boolean
}

export function editWholeWordInput(input: string, target: string, key: string): WholeWordEditResult {
  if (key === 'Backspace') {
    return { input: input.slice(0, -1), submitted: false }
  }

  if (key === ' ') {
    if (target[input.length] === EXPLICIT_SPACE) {
      return { input: input + EXPLICIT_SPACE, submitted: false }
    }
    return { input, submitted: input.length > 0 }
  }

  return { input: input + key, submitted: false }
}

export function compareWholeWordInput(input: string, target: string, ignoreCase: boolean) {
  const actual = ignoreCase ? input.toLocaleLowerCase() : input
  const expected = ignoreCase ? target.toLocaleLowerCase() : target
  const sharedLength = Math.min(actual.length, expected.length)

  for (let index = 0; index < sharedLength; index++) {
    if (actual[index] !== expected[index]) return { correct: false, mismatchIndex: index }
  }

  if (actual.length !== expected.length) return { correct: false, mismatchIndex: sharedLength }
  return { correct: true, mismatchIndex: -1 }
}
