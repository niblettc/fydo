import type { CommitDetail } from '../github'
import type {
  AnalysisReport,
  CommitStatus,
  FileScan,
  Finding,
  RuleResult,
  Severity,
} from '../types'
import { OWASP_RULES, ruleAppliesToFile } from './owasp'

interface AddedLine {
  lineNumber: number
  content: string
}

/** Extract added lines (with new-file line numbers) from a unified diff patch. */
export function parseAddedLines(patch: string): AddedLine[] {
  const added: AddedLine[] = []
  let newLine = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw)
      newLine = m ? Number(m[1]) : 0
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push({ lineNumber: newLine, content: raw.slice(1) })
      newLine++
    } else if (!raw.startsWith('-')) {
      newLine++
    }
  }
  return added
}

export function analyzeCommit(detail: CommitDetail): AnalysisReport {
  const findings: Finding[] = []
  const fileScans: FileScan[] = []
  const ruleStats = new Map<string, { filesChecked: number; linesChecked: number; hits: number }>()
  for (const rule of OWASP_RULES) {
    ruleStats.set(rule.id, { filesChecked: 0, linesChecked: 0, hits: 0 })
  }

  for (const file of detail.files ?? []) {
    if (file.status === 'removed') {
      fileScans.push({
        filename: file.filename,
        scanned: false,
        skipReason: 'removed',
        addedLines: 0,
        commentLinesSkipped: 0,
        rulesApplied: 0,
        hits: 0,
      })
      continue
    }
    if (!file.patch) {
      fileScans.push({
        filename: file.filename,
        scanned: false,
        skipReason: 'no-diff',
        addedLines: 0,
        commentLinesSkipped: 0,
        rulesApplied: 0,
        hits: 0,
      })
      continue
    }
    const rules = OWASP_RULES.filter((r) => ruleAppliesToFile(r, file.filename))
    const addedLines = parseAddedLines(file.patch)
    if (rules.length === 0) {
      fileScans.push({
        filename: file.filename,
        scanned: false,
        skipReason: 'no-applicable-rules',
        addedLines: addedLines.length,
        commentLinesSkipped: 0,
        rulesApplied: 0,
        hits: 0,
      })
      continue
    }

    let commentLinesSkipped = 0
    let fileHits = 0
    let evaluatedLines = 0
    for (const { lineNumber, content } of addedLines) {
      const trimmed = content.trim()
      // Skip pure comment lines to cut noise from docs and commented-out code
      if (/^(?:\/\/|#|\*|\/\*|<!--)/.test(trimmed)) {
        commentLinesSkipped++
        continue
      }
      evaluatedLines++
      for (const rule of rules) {
        const stats = ruleStats.get(rule.id)!
        stats.linesChecked++
        if (rule.pattern.test(content)) {
          stats.hits++
          fileHits++
          findings.push({
            ruleId: rule.id,
            owaspId: rule.owaspId,
            title: rule.title,
            severity: rule.severity,
            description: rule.description,
            remediation: rule.remediation,
            file: file.filename,
            line: lineNumber,
            snippet: trimmed.slice(0, 200),
          })
        }
      }
    }
    for (const rule of rules) {
      ruleStats.get(rule.id)!.filesChecked++
    }
    fileScans.push({
      filename: file.filename,
      scanned: true,
      addedLines: evaluatedLines,
      commentLinesSkipped,
      rulesApplied: rules.length,
      hits: fileHits,
      patch: file.patch.slice(0, 4000),
    })
  }

  const ruleResults: RuleResult[] = OWASP_RULES.map((rule) => {
    const stats = ruleStats.get(rule.id)!
    return {
      ruleId: rule.id,
      owaspId: rule.owaspId,
      title: rule.title,
      severity: rule.severity,
      ...stats,
    }
  })

  return {
    findings: sortFindings(findings),
    ruleResults,
    fileScans,
    totalLinesChecked: fileScans.reduce((n, f) => n + (f.scanned ? f.addedLines : 0), 0),
    totalRulesEvaluated: ruleResults.filter((r) => r.filesChecked > 0).length,
    analyzedAt: new Date().toISOString(),
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

export function statusForFindings(findings: Finding[]): CommitStatus {
  if (findings.length === 0) return 'pass'
  const worst = findings.reduce(
    (acc, f) => Math.max(acc, SEVERITY_ORDER[f.severity]),
    0,
  )
  return worst >= 2 ? 'fail' : 'warn'
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
}
