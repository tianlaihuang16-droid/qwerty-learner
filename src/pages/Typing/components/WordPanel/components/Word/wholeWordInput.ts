const EXPLICIT_SPACE = '␣'

export type WholeWordEditResult = {
  input: string
  submitted: boolean
}

export type WholeWordDifference = {
  type: 'missing' | 'extra' | 'wrong'
  // Zero-based position in the correct word; extra letters use the insertion point.
  position: number
  expected: string
  actual: string
}

export type WholeWordColumn = { actual: string; expected: string; type: 'match' | WholeWordDifference['type'] }

export function alignWholeWordInput(input: string, target: string, ignoreCase: boolean): WholeWordColumn[] {
  const differences = diffWholeWordInput(input, target, ignoreCase)
  const columns: WholeWordColumn[] = []
  let actualIndex = 0
  let expectedIndex = 0
  let differenceIndex = 0
  while (actualIndex < input.length || expectedIndex < target.length) {
    const difference = differences[differenceIndex]
    if (difference && difference.position === expectedIndex) {
      if (difference.type === 'extra') {
        columns.push({ actual: input[actualIndex++], expected: '', type: 'extra' })
      } else if (difference.type === 'missing') {
        columns.push({ actual: '', expected: target[expectedIndex++], type: 'missing' })
      } else {
        columns.push({ actual: input[actualIndex++], expected: target[expectedIndex++], type: 'wrong' })
      }
      differenceIndex++
    } else {
      columns.push({ actual: input[actualIndex++], expected: target[expectedIndex++], type: 'match' })
    }
  }
  return columns
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

export function diffWholeWordInput(input: string, target: string, ignoreCase: boolean): WholeWordDifference[] {
  const actual = ignoreCase ? input.toLocaleLowerCase() : input
  const expected = ignoreCase ? target.toLocaleLowerCase() : target
  const costs = Array.from({ length: target.length + 1 }, () => new Array<number>(input.length + 1).fill(0))

  for (let i = target.length; i >= 0; i--) {
    for (let j = input.length; j >= 0; j--) {
      if (i === target.length) costs[i][j] = input.length - j
      else if (j === input.length) costs[i][j] = target.length - i
      else if (expected[i] === actual[j]) costs[i][j] = costs[i + 1][j + 1]
      else costs[i][j] = 1 + Math.min(costs[i + 1][j + 1], costs[i + 1][j], costs[i][j + 1])
    }
  }

  const differences: WholeWordDifference[] = []
  let i = 0
  let j = 0
  while (i < target.length || j < input.length) {
    if (i < target.length && j < input.length && expected[i] === actual[j]) {
      i++
      j++
      continue
    }
    const wrong = i < target.length && j < input.length ? costs[i + 1][j + 1] : Infinity
    const missing = i < target.length ? costs[i + 1][j] : Infinity
    const extra = j < input.length ? costs[i][j + 1] : Infinity
    if (wrong <= missing && wrong <= extra) {
      differences.push({ type: 'wrong', position: i, expected: target[i], actual: input[j] })
      i++
      j++
    } else if (missing <= extra) {
      differences.push({ type: 'missing', position: i, expected: target[i], actual: '' })
      i++
    } else {
      differences.push({ type: 'extra', position: i, expected: '', actual: input[j] })
      j++
    }
  }
  return differences
}

export function compareWholeWordInput(input: string, target: string, ignoreCase: boolean) {
  const differences = diffWholeWordInput(input, target, ignoreCase)
  return { correct: differences.length === 0, mismatchIndex: differences[0]?.position ?? -1 }
}
