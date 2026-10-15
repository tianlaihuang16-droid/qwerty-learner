const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function load(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020 } }).outputText
  const box = { exports: {} }
  new Function('module', 'exports', 'require', 'structuredClone', 'crypto', 'performance', js)(
    box, box.exports, name => name === './word-learning-identity'
      ? { mergeSourceDicts: (sources, dict) => [...new Set([...sources, dict])] }
      : name === './fsrs-parameters' ? require('./helpers/load-ts.cjs')(path.join(root, 'src/utils/db/fsrs-parameters.ts')) : require(name),
    structuredClone, require('node:crypto').webcrypto, performance)
  return box.exports
}
const { rateSpellingAttempt, decideSpacedReview, getFsrsMemoryMetrics } = load('src/utils/db/spaced-repetition.ts')
const { SpellingRecorder } = load('src/utils/spellingPractice.ts')

let elapsed = 0
const recorder = new SpellingRecorder({ exposureId: 'one', sessionId: 'session', sourceIndex: 0,
  word: 'word', kind: 'main', retryNumber: 0, startedAt: 100 }, () => elapsed)
recorder.setActive(true)
elapsed += 300
recorder.key('x', 'w', false, 'hidden', false, false)
assert.equal(recorder.markLastErrorAsSlip(), true, 'latest wrong attempt can be marked as a slip')
assert.equal(recorder.snapshot().attempts[0].error.isSlip, true)
recorder.startNextAttempt()
for (const [index, key] of [...'word'].entries()) {
  elapsed += 120
  recorder.key(key, key, true, 'hidden', index === 3, false)
}
const spelling = recorder.snapshot()
const record = { word: 'word', dict: 'english', timeStamp: 102, wrongCount: 1,
  timing: [120, 120, 120], spelling }
assert.equal(rateSpellingAttempt(record), 'good', 'marked slip does not force Again')
assert.equal(rateSpellingAttempt({ ...record, spelling: { ...spelling, attempts: spelling.attempts.map((attempt, index) =>
  index === 0 ? { ...attempt, error: { ...attempt.error, isSlip: false } } : attempt) } }), 'again',
  'unmarked wrong attempt remains Again')
const decision = decideSpacedReview(undefined, record, { scope: 'en', normalizedWord: 'word' })
assert.equal(decision.algorithm.startsWith('fsrs-6'), true)
assert.equal(decision.rating, 'good')
assert.equal(decision.evidence, 'independent', 'marked slip retains independent hidden dictation evidence')
assert.ok(decision.state.fsrsCard)
const unchanged = JSON.stringify(decision.state)
const initialMetrics = getFsrsMemoryMetrics(decision.state, decision.state.fsrsCard.lastReviewMs)
const laterMetrics = getFsrsMemoryMetrics(decision.state, decision.state.fsrsCard.lastReviewMs + 86400000)
assert.equal(initialMetrics.retrievability, 1)
assert.ok(laterMetrics.retrievability < initialMetrics.retrievability)
assert.equal(initialMetrics.stability, decision.state.fsrsCard.stability)
assert.equal(initialMetrics.difficulty, decision.state.fsrsCard.difficulty)
assert.equal(getFsrsMemoryMetrics({ ...decision.state, fsrsCard: undefined }), null)
assert.equal(JSON.stringify(decision.state), unchanged, 'memory display must not modify scheduling state')
assert.ok(decision.state.nextReviewAt > record.timeStamp)
const clean = { ...record, wrongCount: 0, spelling: { ...spelling,
  attempts: [spelling.attempts[1]] } }
assert.equal(rateSpellingAttempt(clean), 'easy', 'prompt first key and smooth typing are Easy')
const slow = { ...clean, spelling: { ...clean.spelling, attempts: [{ ...clean.spelling.attempts[0],
  firstKeyDelayMs: 2500 }] } }
assert.equal(rateSpellingAttempt(slow), 'hard', 'significant first-key pause is Hard')
const retry = decideSpacedReview(decision.state, { ...record, timeStamp: decision.state.nextReviewAt + 1,
  spelling: { ...spelling, kind: 'retry' } }, { scope: 'en', normalizedWord: 'word' })
assert.equal(retry.state.nextReviewAt, decision.state.nextReviewAt, 'same-round retry preserves long-term deadline')
const assisted = decideSpacedReview(undefined, { ...clean, spelling: { ...clean.spelling,
  attempts: [{ ...clean.spelling.attempts[0], answerRevealed: true }] } },
{ scope: 'en', normalizedWord: 'word' })
assert.equal(assisted.rating, 'again', 'visible new answer needs an unprompted retest')
assert.equal(assisted.evidence, 'assisted')
assert.ok(assisted.state.nextReviewAt > clean.timeStamp)
console.log('PASS FSRS-6 spelling rating and slip evidence')
