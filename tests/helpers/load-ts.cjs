const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
module.exports = function load(file) {
  const box = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('module', 'exports', 'require', js)(box, box.exports, name =>
    name.startsWith('.') ? module.exports(path.resolve(path.dirname(file), name + '.ts')) : require(name))
  return box.exports
}
