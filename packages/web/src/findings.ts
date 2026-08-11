/** Derives the single source of truth for what the UI shows about a commit:
 * unified findings (scanner + AI + manual triage) and the status/counts
 * computed from them. */

import { mergeFindings, statusForUnifiedFindings, worstActiveSeverity } from '@fydo/core'
import type {
  AiReview,
  AnalyzedCommit,
  CommitStatus,
  FindingOverride,
  FindingStatus,
  Severity,
  UnifiedFinding,
} from '@fydo/core'

/** Filters the stat cards and feeds share; 'active' = open + needs-review */
export type StatusFilter = 'active' | 'open' | 'needs-review' | 'closed' | 'all'
export type SeverityFilter = Severity | 'all'

export function matchesStatusFilter(status: FindingStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'active':
      return status === 'open' || status === 'needs-review'
    case 'closed':
      return status === 'dismissed' || status === 'resolved'
    case 'all':
      return true
    default:
      return status === filter
  }
}

export function findingMatchesFilters(
  finding: Pick<UnifiedFinding, 'status' | 'severity'>,
  status: StatusFilter,
  severity: SeverityFilter,
): boolean {
  return (
    matchesStatusFilter(finding.status, status) &&
    (severity === 'all' || finding.severity === severity)
  )
}

/** Overall risk ratings that must surface even without itemized findings */
const RISK_SEVERITY: Partial<Record<AiReview['overallRisk'], Severity>> = {
  medium: 'medium',
  high: 'high',
  critical: 'critical',
}

export interface CommitView {
  findings: UnifiedFinding[]
  status: CommitStatus
  openCount: number
  needsReviewCount: number
  worstSeverity: Severity | null
  /** True once the AI review has weighed in on this commit */
  reviewed: boolean
}

export function commitView(
  commit: AnalyzedCommit,
  review: AiReview | undefined,
  overrides: Record<string, FindingOverride>,
): CommitView {
  if (commit.status === 'analyzing' || commit.status === 'error') {
    return {
      findings: [],
      status: commit.status,
      openCount: 0,
      needsReviewCount: 0,
      worstSeverity: null,
      reviewed: false,
    }
  }
  const findings = mergeFindings(commit.sha, commit.findings, review, overrides)

  // An AI risk rating of medium or higher with nothing actionable itemized
  // (older prose-only reviews, or every finding triaged away) becomes a real
  // finding with that severity, so the severity counters, commit status, and
  // triage flow all pick it up through the normal path.
  const riskSeverity = review ? RISK_SEVERITY[review.overallRisk] : undefined
  const hasUnresolved = findings.some((f) => f.status === 'open' || f.status === 'needs-review')
  if (review && riskSeverity && !hasUnresolved) {
    const id = `${commit.sha}:ai-risk`
    const override = overrides[id]
    findings.push({
      id,
      source: 'ai',
      status: override?.status ?? 'needs-review',
      statusReason: override?.note,
      severity: riskSeverity,
      title: `AI rated this commit ${review.overallRisk} risk`,
      description: review.summary,
      remediation: 'Re-run the AI review to itemize the issues, or triage this rating manually.',
    })
  }

  return {
    findings,
    status: statusForUnifiedFindings(findings),
    openCount: findings.filter((f) => f.status === 'open').length,
    needsReviewCount: findings.filter((f) => f.status === 'needs-review').length,
    worstSeverity: worstActiveSeverity(findings),
    reviewed: review !== undefined,
  }
}

export function viewKey(commit: AnalyzedCommit): string {
  return `${commit.branch}:${commit.sha}`
}

/** One finding with the commit it came from, for the findings feed */
export interface FindingFeedItem {
  finding: UnifiedFinding
  commit: AnalyzedCommit
  /** All monitored branches this commit appears on */
  branches: string[]
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

/** Flattens commit views into one finding-centric list, deduped by finding id
 * (a sha on two monitored branches yields identical finding ids), sorted by
 * severity then commit recency. */
export function findingFeedItems(
  commits: AnalyzedCommit[],
  views: Map<string, CommitView>,
): FindingFeedItem[] {
  const byId = new Map<string, FindingFeedItem>()
  for (const c of commits) {
    const view = views.get(viewKey(c))
    if (!view) continue
    for (const f of view.findings) {
      const existing = byId.get(f.id)
      if (existing) {
        if (!existing.branches.includes(c.branch)) existing.branches.push(c.branch)
      } else {
        byId.set(f.id, { finding: f, commit: c, branches: [c.branch] })
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[b.finding.severity] - SEVERITY_ORDER[a.finding.severity] ||
      new Date(b.commit.date).getTime() - new Date(a.commit.date).getTime(),
  )
}
