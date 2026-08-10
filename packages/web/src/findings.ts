/** Derives the single source of truth for what the UI shows about a commit:
 * unified findings (scanner + AI + manual triage) and the status/counts
 * computed from them. */

import { mergeFindings, statusForUnifiedFindings, worstActiveSeverity } from '@fydo/core'
import type {
  AiReview,
  AnalyzedCommit,
  CommitStatus,
  FindingOverride,
  Severity,
  UnifiedFinding,
} from '@fydo/core'

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
  let status = statusForUnifiedFindings(findings)
  // Safety net: a review that rates the commit high/critical without itemizing
  // any findings is contradictory — surface it instead of showing Clean.
  if (
    status === 'clean' &&
    review &&
    (review.overallRisk === 'high' || review.overallRisk === 'critical')
  ) {
    status = 'needs-review'
  }
  return {
    findings,
    status,
    openCount: findings.filter((f) => f.status === 'open').length,
    needsReviewCount: findings.filter((f) => f.status === 'needs-review').length,
    worstSeverity: worstActiveSeverity(findings),
    reviewed: review !== undefined,
  }
}

export function viewKey(commit: AnalyzedCommit): string {
  return `${commit.branch}:${commit.sha}`
}
