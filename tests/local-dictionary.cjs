const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = join(__dirname, '../src/utils/localDictionaryFormat.mjs')
assert.ok(existsSync(modulePath), 'local dictionary parser must exist')

async function main() {
  const { parseLocalDictionary } = await import(pathToFileURL(modulePath).href)
  const words = parseLocalDictionary('My Words.json', JSON.stringify([
    { name: 'environment', trans: ['环境'], usphone: 'ɪnˈvaɪrənmənt' },
    { name: '  spelling  ', trans: '拼写' },
    { name: 'ENVIRONMENT', trans: ['重复'] },
  ]))
  assert.equal(words.length, 2)
  assert.deepEqual(words[0], { name: 'environment', trans: ['环境'], usphone: 'ɪnˈvaɪrənmənt', ukphone: '' })
  assert.deepEqual(words[1], { name: 'spelling', trans: ['拼写'], usphone: '', ukphone: '' })
  assert.throws(() => parseLocalDictionary('bad.json', '{'), /JSON/)
  assert.throws(() => parseLocalDictionary('empty.json', '[]'), /至少包含一个/)
  assert.throws(() => parseLocalDictionary('bad.json', '[{"name":42}]'), /第 1 个单词/)
  const extended = parseLocalDictionary('variants.json', JSON.stringify([{ name: 'unhelpful', segments: ['un', 'help', 'ful'], spellings: ['unhelpful'] }]))[0]
  assert.deepEqual(extended.segments, ['un', 'help', 'ful'])
  assert.deepEqual(extended.spellings, ['unhelpful'])
  assert.throws(() => parseLocalDictionary('bad.json', JSON.stringify([{ name: 'word', segments: ['w', 'bad'] }])), /segments/)
  assert.throws(() => parseLocalDictionary('bad.json', JSON.stringify([{ name: 'word', spellings: [''] }])), /spellings/)
  console.log('local dictionary parsing: pass')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
