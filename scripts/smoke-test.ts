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

const report = analyzeCommit(detail)
const findings = report.findings
console.log(`status: ${statusForFindings(findings)} (expect fail)`)
console.log(
  `evidence: ${report.totalLinesChecked} lines checked (expect 6), ` +
    `${report.totalRulesEvaluated} rules evaluated, ` +
    `${report.fileScans.length} file scans (expect 1)`,
)
const scan = report.fileScans[0]
if (!scan.scanned || scan.addedLines !== 6 || scan.commentLinesSkipped !== 1) {
  console.error(`FAIL: unexpected file scan record: ${JSON.stringify(scan)}`)
  process.exit(1)
}
const sqlRule = report.ruleResults.find((r) => r.ruleId === 'A03-001')
if (!sqlRule || sqlRule.hits !== 1 || sqlRule.linesChecked !== 6 || sqlRule.filesChecked !== 1) {
  console.error(`FAIL: unexpected rule result for A03-001: ${JSON.stringify(sqlRule)}`)
  process.exit(1)
}
const passingRule = report.ruleResults.find((r) => r.ruleId === 'A08-001')
if (!passingRule || passingRule.hits !== 0 || passingRule.linesChecked !== 6) {
  console.error(`FAIL: passing rule should show 6 lines checked with 0 hits: ${JSON.stringify(passingRule)}`)
  process.exit(1)
}
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
