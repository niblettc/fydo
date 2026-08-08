import type { CommitDetail } from '../github'
import type { CommitStatus, Finding, Severity } from '../types'
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

export function analyzeCommit(detail: CommitDetail): Finding[] {
  const findings: Finding[] = []
  for (const file of detail.files ?? []) {
    if (!file.patch || file.status === 'removed') continue
    const rules = OWASP_RULES.filter((r) => ruleAppliesToFile(r, file.filename))
    if (rules.length === 0) continue
    const addedLines = parseAddedLines(file.patch)
    for (const { lineNumber, content } of addedLines) {
      const trimmed = content.trim()
      // Skip pure comment lines to cut noise from docs and commented-out code
      if (/^(?:\/\/|#|\*|\/\*|<!--)/.test(trimmed)) continue
      for (const rule of rules) {
        if (rule.pattern.test(content)) {
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
  }
  return findings
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
