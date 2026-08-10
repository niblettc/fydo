/** Merges scanner findings, AI verdicts, AI-discovered findings, and manual
 * triage overrides into one UnifiedFinding list per commit. Commit status and
 * dashboard counts derive from this list — never from raw detector output. */

import type {
  AiReview,
  CommitStatus,
  Finding,
  FindingOverride,
  FindingStatus,
  Severity,
  UnifiedFinding,
} from '../types'

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b
}

export function ruleFindingId(sha: string, f: Finding): string {
  return `${sha}:r:${f.ruleId}:${f.file}:${f.line}`
}

export function aiFindingId(sha: string, index: number): string {
  return `${sha}:a:${index}`
}

export function mergeFindings(
  sha: string,
  scannerFindings: Finding[],
  review?: AiReview,
  overrides?: Record<string, FindingOverride>,
): UnifiedFinding[] {
  const unified: UnifiedFinding[] = scannerFindings.map((f, index) => {
    const verdict = review?.verdicts.find((v) => v.findingIndex === index)
    let status: FindingStatus = 'needs-review'
    let statusReason: string | undefined
    if (verdict) {
      statusReason = verdict.explanation
      status =
        verdict.verdict === 'confirmed'
          ? 'open'
          : verdict.verdict === 'false-positive'
            ? 'dismissed'
            : 'needs-review'
    }
    return {
      id: ruleFindingId(sha, f),
      source: 'rules' as const,
      status,
      statusReason,
      severity: f.severity,
      title: f.title,
      description: f.description,
      remediation: verdict?.suggestedAction ?? f.remediation,
      owaspId: f.owaspId,
      file: f.file,
      line: f.line,
      snippet: f.snippet,
      ruleId: f.ruleId,
    }
  })

  for (const [index, af] of (review?.additionalFindings ?? []).entries()) {
    // Same file and roughly the same line as a rules finding → one finding
    // confirmed by both detectors, not two entries.
    const match = af.file
      ? unified.find(
          (u) =>
            u.source === 'rules' &&
            u.file === af.file &&
            af.line != null &&
            u.line != null &&
            Math.abs(u.line - af.line) <= 2,
        )
      : undefined
    if (match) {
      match.source = 'both'
      match.severity = maxSeverity(match.severity, af.severity)
      if (match.status !== 'dismissed') match.status = 'open'
      match.statusReason = af.explanation
      if (af.suggestedAction) match.remediation = af.suggestedAction
      continue
    }
    unified.push({
      id: aiFindingId(sha, index),
      source: 'ai',
      status: 'open',
      severity: af.severity,
      title: af.title,
      description: af.explanation,
      remediation: af.suggestedAction,
      owaspId: af.owaspId,
      file: af.file,
      line: af.line,
    })
  }

  // Manual triage always wins over detector output.
  if (overrides) {
    for (const finding of unified) {
      const override = overrides[finding.id]
      if (override) {
        finding.status = override.status
        if (override.note) finding.statusReason = override.note
      }
    }
  }

  return unified.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity])
}

export function statusForUnifiedFindings(findings: UnifiedFinding[]): CommitStatus {
  if (findings.some((f) => f.status === 'open')) return 'findings'
  if (findings.some((f) => f.status === 'needs-review')) return 'needs-review'
  return 'clean'
}

/** Findings that still demand attention (open or awaiting review) */
export function activeFindings(findings: UnifiedFinding[]): UnifiedFinding[] {
  return findings.filter((f) => f.status === 'open' || f.status === 'needs-review')
}

export function worstActiveSeverity(findings: UnifiedFinding[]): Severity | null {
  const active = activeFindings(findings)
  if (active.length === 0) return null
  return active.reduce<Severity>((worst, f) => maxSeverity(worst, f.severity), 'low')
}
