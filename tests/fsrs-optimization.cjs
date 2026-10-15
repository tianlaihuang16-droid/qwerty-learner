const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const storage = new Map()
global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
const cache = new Map()
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const box = { exports: {} }
  cache.set(file, box.exports)
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('module', 'exports', 'require', js)(box, box.exports, name => {
    if (name === '@/resources/dictionary') return { idDictionaryMap: { en: { language: 'en' }, other: { language: 'en' }, private: { language: 'en', reviewScope: 'dictionary' } } }
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)
  })
  return box.exports
}
const profiles = load('src/utils/db/fsrs-parameters.ts')
const opt = load('src/utils/db/fsrs-optimization.ts')
const engine = load('src/utils/db/spaced-repetition.ts')
const base = profiles.getFsrsParameters()
assert.equal(base.version, 'fsrs6-default-1')
assert.equal(profiles.isFsrsWeights([1, 2]), false)
assert.equal(profiles.isFsrsWeights(base.weights.map((w, i) => i === 20 ? 0 : w)), false)
assert.equal(profiles.isFsrsWeights(base.weights.map((w, i) => i === 5 ? NaN : w)), false)
const custom = { version: 'fsrs6-personal-test', weights: base.weights.map((w, i) => i === 3 ? w / 2 : w), optimizedAt: 1 }
profiles.saveFsrsParameters(custom)
assert.deepEqual(profiles.getFsrsParameters(), custom)
const at = 1000000000
const record = (word, day, rating, reason = day ? 'independent-due' : 'new', extra = {}) => ({ word, dict: 'en', timeStamp: at / 1000 + day * 86400,
  wrongCount: rating === 'again' ? 1 : 0, timing: [], spelling: { version: 1, kind: 'main', outcome: 'completed', completedAtMs: at + day * 86400000,
    attempts: [{ outcome: rating === 'again' ? 'error' : 'correct', answerRevealed: false, keys: [{ visibility: 'hidden', targetVisible: false }] }] },
  spacedReviewDecision: { algorithm: engine.SPACED_REVIEW_ALGORITHM, evidence: 'independent', rating, reason,
    fsrsCardBefore: { reps: day ? 1 : 0, state: day ? 2 : 0, lastReviewMs: day ? at + (day - 1) * 86400000 : undefined } }, ...extra })
const rows = []
for (let i = 0; i < 100; i++) {
  const review = record('w' + i, 1, i % 3 ? 'good' : 'again')
  review.spelling.completedAtMs += i * 1000
  rows.push(record('w' + i, 0, 'good'), review)
}
const dataset = opt.buildFsrsOptimizationDataset(rows)
assert.equal(dataset.items.length, 100)
assert.equal(dataset.wordCount, 100)
const split = opt.splitFsrsOptimizationDataset(dataset.items)
assert.equal(split.train.length, 80)
assert.equal(split.validation.length, 20)
assert.ok(split.train.every(x => x.atMs < split.cutoffMs))
assert.ok(split.validation.every(x => x.atMs >= split.cutoffMs))
assert.throws(() => opt.splitFsrsOptimizationDataset(dataset.items.slice(0, 20)), /样本/)
assert.equal(opt.buildFsrsOptimizationDataset([record('truncated', 1, 'good')]).items.length, 0)
assert.equal(opt.buildFsrsOptimizationDataset([record('missing-attempts', 0, 'good', 'new', { spelling: { version: 1, kind: 'main', outcome: 'completed' } })]).items.length, 0)
assert.equal(opt.buildFsrsOptimizationDataset([record('assisted', 0, 'good'), record('assisted', 1, 'good', 'assisted-retest'), record('assisted', 2, 'good')]).items.length, 0)
assert.equal(opt.buildFsrsOptimizationDataset([record('same', 0, 'good'), record('same', 0, 'good')]).items.length, 0)
const crossStart = record('midnight', 0, 'good')
crossStart.timeStamp = Date.parse('2026-09-28T20:00:00Z') / 1000
crossStart.spelling.completedAtMs = crossStart.timeStamp * 1000
const crossEnd = record('midnight', 1, 'good')
crossEnd.timeStamp = Date.parse('2026-09-29T12:00:00Z') / 1000
crossEnd.spelling.completedAtMs = crossEnd.timeStamp * 1000
crossEnd.spacedReviewDecision.fsrsCardBefore.lastReviewMs = crossStart.spelling.completedAtMs
assert.equal(opt.buildFsrsOptimizationDataset([crossStart, crossEnd]).items[0]?.reviews[1].delta_t, 1, 'training uses the scheduler UTC day boundary, even for a 16-hour gap')
const firstFailure = record('new-again', 0, 'again', 'failure')
firstFailure.spacedReviewDecision.fsrsCardBefore.lastReviewMs = 0
assert.equal(opt.buildFsrsOptimizationDataset([firstFailure, record('new-again', 1, 'good')]).items[0]?.reviews[0].rating, 1, 'a genuine new-card Again is an initial anchor')
const forcedAgain = record('unknown-correct', 0, 'again', 'failure')
forcedAgain.spelling.attempts[0].outcome = 'correct'
assert.equal(opt.buildFsrsOptimizationDataset([forcedAgain, record('unknown-correct', 1, 'good')]).items.length, 0, 'a correct answer forced to Again for incomplete evidence is not a genuine recall failure')
const replayRecord = { word: 'word', dict: 'en', timeStamp: 100, wrongCount: 0, timing: [] }
const decision = engine.decideSpacedReview(undefined, replayRecord, { scope: 'en', normalizedWord: 'word' })
assert.deepEqual(decision.schedulerWeights, custom.weights)
profiles.resetFsrsParameters()
assert.deepEqual(engine.decideSpacedReview(undefined, { ...replayRecord, spacedReviewDecision: decision }, { scope: 'en', normalizedWord: 'word' }).state.fsrsCard, decision.state.fsrsCard)
assert.notDeepEqual(engine.nextFsrsCard(null, at, 'easy'), engine.nextFsrsCard(null, at, 'easy', custom.weights))
console.log('PASS FSRS optimization selection, split, profiles and historical replay')
