const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/utils/dailyCleanRate.ts', 'utf8')
const sandbox = { exports: {}, Date }
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, sandbox)
const { buildDailyCleanRates } = sandbox.exports
const timeStamp = new Date(2026, 9, 2, 0, 1).getTime() / 1000
const attempt = (outcome = 'correct') => ({ number: 1, outcome, answerRevealed: false,
  keys: [{ visibility: 'hidden', targetVisible: false }] })
const record = (first = attempt(), extra = {}) => ({ timeStamp,
  spelling: { kind: 'main', outcome: 'completed', attempts: [first], ...extra } })
const records = [record(), record(attempt('error')),
  record({ ...attempt(), answerRevealed: true }),
  record({ ...attempt(), keys: [{ visibility: 'full', targetVisible: true }] }),
  record(attempt(), { kind: 'retry' }), { timeStamp },
  record(attempt('interrupted')), record({ ...attempt(), keys: [{ visibility: 'hidden' }] }),
  record(attempt(), { outcome: 'interrupted' }),
  record(attempt('error'), { attempts: [attempt('error'), { ...attempt(), number: 2 }] }),
]
const day = buildDailyCleanRates(records)[0]
assert.equal(day.date, '2026-10-02')
assert.equal(day.correct, 1)
assert.equal(day.eligible, 3)
assert.equal(day.excluded, 7)
assert.equal(day.rate, 33.3)
assert.equal(buildDailyCleanRates([{ timeStamp }])[0].rate, null)
assert.equal(buildDailyCleanRates([record(attempt('error'))])[0].rate, 0)
const dates = Array.from({ length: 20 }, (_, i) => ({ ...record(), timeStamp: new Date(2026, 8, i + 1, 12).getTime() / 1000 }))
assert.equal(buildDailyCleanRates(dates).length, 14)
assert.equal(buildDailyCleanRates(dates)[0].date, '2026-09-07')
console.log('daily first unprompted spelling rate checks passed')
