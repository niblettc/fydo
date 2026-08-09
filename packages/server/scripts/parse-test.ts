// Sanity check for AST parsing + import resolution: npx tsx scripts/parse-test.ts
import { parseFile } from '../src/parse'
import { ImportResolver, componentForPath } from '../src/resolve'

const tsSource = `
import { useState } from 'react'
import type { Thing } from './types'
import * as utils from '../lib/utils'
export { helper } from './helper'
const lazy = await import('./lazy-module')
const legacy = require('./legacy')

export function processData(input: string): Thing { return utils.parse(input) }
export class DataService {}
export const API_URL = 'https://example.com'
interface Internal {}
export type Result = Thing | null
`

const parsed = parseFile('src/services/data.ts', tsSource)!
console.log('imports:', parsed.importSpecifiers)
console.log('symbols:', parsed.symbols.map((s) => `${s.kind}:${s.name}${s.exported ? '*' : ''}`))

const files = [
  'src/services/data.ts',
  'src/services/types.ts',
  'src/services/helper/index.ts',
  'src/services/lazy-module.tsx',
  'src/services/legacy.js',
  'src/lib/utils.ts',
  'app/models/user.py',
  'app/models/__init__.py',
  'app/main.py',
]
const resolver = new ImportResolver(files)

const checks: Array<[string, string, string, unknown]> = [
  ['src/services/data.ts', './types', 'typescript', { type: 'file', path: 'src/services/types.ts' }],
  ['src/services/data.ts', './helper', 'typescript', { type: 'file', path: 'src/services/helper/index.ts' }],
  ['src/services/data.ts', './lazy-module', 'typescript', { type: 'file', path: 'src/services/lazy-module.tsx' }],
  ['src/services/data.ts', './legacy', 'typescript', { type: 'file', path: 'src/services/legacy.js' }],
  ['src/services/data.ts', '../lib/utils', 'typescript', { type: 'file', path: 'src/lib/utils.ts' }],
  ['src/services/data.ts', 'react', 'typescript', { type: 'package', name: 'react' }],
  ['src/services/data.ts', '@scope/pkg/sub', 'typescript', { type: 'package', name: '@scope/pkg' }],
  ['app/main.py', 'app.models.user', 'python', { type: 'file', path: 'app/models/user.py' }],
  ['app/main.py', 'app.models', 'python', { type: 'file', path: 'app/models/__init__.py' }],
  ['app/models/user.py', '.', 'python', { type: 'file', path: 'app/models/__init__.py' }],
  ['app/main.py', 'requests', 'python', { type: 'package', name: 'requests' }],
]

let failed = 0
for (const [from, spec, lang, expected] of checks) {
  const got = resolver.resolve(from, spec, lang)
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) {
    failed++
    console.error(`FAIL resolve(${from}, ${spec}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`)
  }
}

const expectedImports = ['react', './types', '../lib/utils', './helper', './lazy-module', './legacy']
for (const spec of expectedImports) {
  if (!parsed.importSpecifiers.includes(spec)) {
    failed++
    console.error(`FAIL: import specifier ${spec} not extracted`)
  }
}
const exported = parsed.symbols.filter((s) => s.exported).map((s) => s.name)
for (const name of ['processData', 'DataService', 'API_URL', 'Result']) {
  if (!exported.includes(name)) {
    failed++
    console.error(`FAIL: exported symbol ${name} not extracted`)
  }
}
if (parsed.symbols.find((s) => s.name === 'Internal')?.exported) {
  failed++
  console.error('FAIL: Internal should not be exported')
}

console.log('component of src/services/data.ts:', componentForPath('src/services/data.ts'))
if (failed > 0) process.exit(1)
console.log('parse/resolve test passed')
