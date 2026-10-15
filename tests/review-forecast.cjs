const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/utils/reviewForecast.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const box = { exports: {} }
vm.runInNewContext(compiled, box)
const { estimateReviewWords, forecastTomorrowReviews, reviewElapsedSeconds, reviewRoundTimingSamples } = box.exports

assert.equal(reviewElapsedSeconds({ startedAt: 100, completedAtMs: 112_000, outcome: 'completed' }), 12)
assert.equal(reviewElapsedSeconds({ startedAt: 100, completedAtMs: 400_000, outcome: 'completed' }), null)
assert.equal(reviewElapsedSeconds({ completedAtMs: 112_000, outcome: 'completed' }), null)

const now = new Date(2026, 8, 27, 20, 0)
const tomorrow = new Date(2026, 8, 28).getTime() / 1000
const afterTomorrow = new Date(2026, 8, 29).getTime() / 1000
const samples = [
  { key: 'a', seconds: 30, atSeconds: 4 },
  { key: 'a', seconds: 40, atSeconds: 3 },
  { key: 'b', seconds: 10, atSeconds: 2 },
  { key: 'b', seconds: 900, atSeconds: 1 },
]

assert.deepEqual(
  JSON.parse(JSON.stringify(forecastTomorrowReviews(
    [
      { key: 'old', dueAtSeconds: tomorrow - 1 },
      { key: 'a', dueAtSeconds: tomorrow },
      { key: 'b', dueAtSeconds: tomorrow + 12 * 3600 },
      { key: 'later', dueAtSeconds: afterTomorrow },
    ], samples, now,
  ))),
  { count: 2, estimatedMinutes: 1, upperMinutes: 2, sampleCount: 3, matchedWordCount: 2 },
  'tomorrow uses actual per-word elapsed time and omits extreme pause outliers',
)
assert.deepEqual(
  JSON.parse(JSON.stringify(forecastTomorrowReviews([{ key: 'a', dueAtSeconds: tomorrow }], [], now))),
  { count: 1, estimatedMinutes: null, upperMinutes: null, sampleCount: 0, matchedWordCount: 0 },
  'missing history stays unknown',
)
assert.deepEqual(
  JSON.parse(JSON.stringify(forecastTomorrowReviews([], [], now))),
  { count: 0, estimatedMinutes: 0, upperMinutes: 0, sampleCount: 0, matchedWordCount: 0 },
  'zero due words needs zero minutes even without history',
)

console.log('tomorrow review forecast calendar boundaries and historical estimate checks passed')

const trace = (kind, start, end, index = 0) => ({sessionId:'round',sourceIndex:index,kind,startedAt:start,completedAtMs:end,outcome:'completed'})
const grouped = reviewRoundTimingSamples([
  {key:'a',atSeconds:1,trace:trace('main',100,105000)},
  {key:'a',atSeconds:2,trace:trace('retry',110,125000)},
  {key:'b',atSeconds:3,trace:trace('retry',130,135000,1)},
  {key:'c',atSeconds:4,trace:trace('main',140,145000,2)},
  {key:'c',atSeconds:5,trace:trace('retry',150,450000,2)},
])
assert.equal(grouped.length,1,'unlinked retry and incomplete/interrupted timing rounds are excluded')
assert.equal(grouped[0].seconds,20,'main and correction costs are accumulated into one sample')
const current200 = Array.from({length:200},(_,i)=>({key:`word${i}`,dueAtSeconds:now.getTime()/1000-1}))
const currentEstimate = estimateReviewWords(current200,[{key:'other',seconds:6,atSeconds:1}])
assert.equal(currentEstimate.count,200)
assert.equal(currentEstimate.estimatedMinutes,20,'200 words at 6 seconds must not reuse the 18-word tomorrow population')
const withCorrection = estimateReviewWords(current200,grouped)
assert.equal(withCorrection.estimatedMinutes,67,'linked correction time is part of the estimated workload')
assert.equal(estimateReviewWords(current200,[]).estimatedMinutes,null)
console.log('current review population and linked correction workload checks passed')
