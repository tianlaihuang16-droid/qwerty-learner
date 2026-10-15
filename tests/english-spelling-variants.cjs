const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const vm = require('node:vm')
const box = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/englishSpellingVariants.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, box)
const { acceptedEnglishSpellings, matchingSpelling } = box.exports
for (const [a, b] of [['organisation', 'organization'], ['colour', 'color'], ['centre', 'center'],
  ['travelling', 'traveling'], ['analyse', 'analyze'], ['recognised', 'recognized'],
  ['stabilise', 'stabilize'], ['stabilised', 'stabilized'], ['stabilising', 'stabilizing'],
  ['stabilisation', 'stabilization'], ['minimise', 'minimize'], ['utilise', 'utilize'],
  ['authorisation', 'authorization'], ['characterise', 'characterize'], ['normalise', 'normalize'],
  ['digitalisation', 'digitalization'], ['pedestrianisation', 'pedestrianization'],
  ['pedestrianise', 'pedestrianize'], ['pedestrianised', 'pedestrianized'], ['reorganise', 'reorganize'],
  ['harbour', 'harbor'], ['harboured', 'harbored'], ['harbouring', 'harboring'],
  ['amphitheatre', 'amphitheater'], ['encyclopaedia', 'encyclopedia'], ['instal', 'install']]) {
  for (const [target, input] of [[a, b], [b, a]]) {
    const candidates = acceptedEnglishSpellings(target, 'en')
    assert.equal(matchingSpelling(input, candidates, false), input)
    for (let i = 1; i <= input.length; i++) assert.ok(matchingSpelling(input.slice(0, i), candidates, false, true))
    assert.equal(matchingSpelling(input + 'x', candidates, false), undefined)
  }
}
assert.equal(matchingSpelling('organiZation', acceptedEnglishSpellings('organisation', 'en'), true), 'organization')
assert.equal(matchingSpelling('organization', acceptedEnglishSpellings('Organisation', 'en'), false), undefined)
assert.equal(matchingSpelling('Organization', acceptedEnglishSpellings('Organisation', 'en'), false), 'Organization')
for (const [target, typo] of [['organisation', 'orginization'], ['surprise', 'surprize'], ['advise', 'advize'],
  ['exercise', 'exercize'], ['supervise', 'supervize'], ['stabilise', 'stablize']])
  assert.equal(matchingSpelling(typo, acceptedEnglishSpellings(target, 'en'), false), undefined)
assert.equal(matchingSpelling('organization', acceptedEnglishSpellings('organisation', 'code'), false), undefined)
assert.ok(acceptedEnglishSpellings('colour␣organisation', 'en').includes('color␣organization'))
const dictionarySpellings = acceptedEnglishSpellings('aeroplane', 'en', ['aeroplane', 'airplane'])
assert.equal(dictionarySpellings.length, 2)
assert.equal(matchingSpelling('airplane', dictionarySpellings, false), 'airplane')
for (let i = 1; i <= 'airplane'.length; i++) assert.ok(matchingSpelling('airplane'.slice(0, i), dictionarySpellings, false, true))
assert.equal(matchingSpelling('airplne', dictionarySpellings, false), undefined)
assert.equal(matchingSpelling('airplane', acceptedEnglishSpellings('aeroplane', 'code', ['airplane']), false), undefined)
assert.equal(matchingSpelling('organization', acceptedEnglishSpellings('organisation', 'en', ['organisation']), false), undefined,
  'an explicit dictionary spelling list takes precedence over the legacy table')
console.log('English spelling variant and prefix checks passed')
