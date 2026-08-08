// Quick sanity check of the analysis engine: run `node scripts/smoke-test.ts`
import { analyzeCommit, parseAddedLines, statusForFindings } from '../src/compliance/analyzer.ts'
import type { CommitDetail } from '../src/github.ts'

const patch = `@@ -1,4 +10,12 @@
 const db = require('./db')
+const API_KEY = "sk_live_abcdef123456"
+db.query("SELECT * FROM users WHERE id = " + req.params.id)
+const hash = crypto.createHash('md5').update(pw).digest('hex')
+fetch(req.query.url)
+agent = new https.Agent({ rejectUnauthorized: false })
+el.innerHTML = userInput
+// password = "commented-out-should-be-skipped"
 module.exports = db`

const detail = {
  sha: 'deadbeef',
  commit: { message: 'test', author: { name: 't', date: '' } },
  author: null,
  html_url: '',
  stats: { additions: 7, deletions: 0, total: 7 },
  files: [{ filename: 'server/api.js', status: 'modified', additions: 7, deletions: 0, patch }],
} as CommitDetail

const added = parseAddedLines(patch)
console.log(`added lines parsed: ${added.length} (expect 7), first line number: ${added[0].lineNumber} (expect 11)`)

const findings = analyzeCommit(detail)
console.log(`status: ${statusForFindings(findings)} (expect fail)`)
console.log(`findings: ${findings.length}`)
for (const f of findings) {
  console.log(`  [${f.severity}] ${f.owaspId} ${f.ruleId} ${f.title} @ ${f.file}:${f.line}`)
}

const expectedRules = ['A02-002', 'A03-001', 'A02-001', 'A10-001', 'A05-001', 'A03-004']
const hit = new Set(findings.map((f) => f.ruleId))
const missing = expectedRules.filter((r) => !hit.has(r))
if (missing.length > 0) {
  console.error(`MISSING expected rules: ${missing.join(', ')}`)
  process.exit(1)
}
if (findings.some((f) => f.snippet.includes('commented-out'))) {
  console.error('FAIL: comment line was not skipped')
  process.exit(1)
}
console.log('smoke test passed')
