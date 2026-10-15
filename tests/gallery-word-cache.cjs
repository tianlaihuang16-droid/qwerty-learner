const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const box = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/galleryWordCache.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, box)

async function main() {
  let reads = 0
  let fail = false
  const cache = box.exports.createGalleryWordCache(async url => {
    reads++
    if (fail) throw new Error('unavailable')
    return [{ name: `${url}:${reads}`, trans: [], usphone: '', ukphone: '' }]
  })
  const [first, second] = await Promise.all([cache.read('/built-in.json'), cache.read('/built-in.json')])
  assert.equal(reads, 1, 'simultaneous consumers share the same dictionary read')
  assert.deepEqual(first, second)
  const cloud = await cache.read('cloud://words.json')
  cache.invalidateCloud()
  assert.deepEqual(await cache.read('/built-in.json'), first, 'focus does not reread immutable built-in dictionaries')
  assert.notDeepEqual(await cache.read('cloud://words.json'), cloud, 'same-URL cloud edits become visible after activation')
  assert.equal(reads, 3)
  fail = true
  await assert.rejects(cache.read('/retry.json'), /unavailable/)
  fail = false
  assert.equal((await cache.read('/retry.json'))[0].name, '/retry.json:5', 'failed requests are retried rather than cached permanently')

  const pending = []
  const racing = box.exports.createGalleryWordCache(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
  const obsolete = racing.read('cloud://race.json')
  const rejected = assert.rejects(obsolete, /old request/)
  racing.invalidateCloud()
  const current = racing.read('cloud://race.json')
  pending[0].reject(new Error('old request'))
  await rejected
  assert.equal(racing.read('cloud://race.json'), current, 'an obsolete failed request cannot evict a newer cache entry')
  pending[1].resolve([{ name: 'new' }])
  assert.equal((await current)[0].name, 'new')
  let malformed = true
  const validated = box.exports.createGalleryWordCache(async () => malformed ? { error: 'missing file' } : [{ name: 'valid' }])
  await assert.rejects(validated.read('cloud://malformed.json'), /词书/)
  malformed = false
  assert.equal((await validated.read('cloud://malformed.json'))[0].name, 'valid', 'malformed dictionaries are not cached or passed to rendering')
  console.log('PASS gallery dictionary cache shares reads, refreshes cloud edits, retries failures and handles invalidation races')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
