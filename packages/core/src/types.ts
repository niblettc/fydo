export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface OwaspCategory {
  id: string // e.g. "A01"
  code: string // e.g. "A01:2021"
  name: string
  description: string
}

export interface ComplianceRule {
  id: string
  owaspId: string
  title: string
  severity: Severity
  description: string
  remediation: string
  /** Regex applied to each added line of a diff */
  pattern: RegExp
  /** Optional file-path filter; rule only applies when path matches */
  filePattern?: RegExp
}

export interface Finding {
  ruleId: string
  owaspId: string
  title: string
  severity: Severity
  description: string
  remediation: string
  file: string
  line: number
  snippet: string
}

export type CommitStatus = 'clean' | 'findings' | 'needs-review' | 'analyzing' | 'error'

/** Which detector produced a unified finding */
export type FindingSource = 'rules' | 'ai' | 'both'

/** Lifecycle of a unified finding: AI verdicts and manual triage move it */
export type FindingStatus = 'open' | 'needs-review' | 'dismissed' | 'resolved'

/** One actionable issue, regardless of whether regex rules or AI found it.
 * Detection source is metadata; commit status and all counts derive from
 * the open/needs-review findings. */
export interface UnifiedFinding {
  /** Deterministic id (includes the commit sha) so manual triage can be persisted */
  id: string
  source: FindingSource
  status: FindingStatus
  /** AI explanation or manual triage note behind the current status */
  statusReason?: string
  severity: Severity
  title: string
  description: string
  remediation?: string
  owaspId?: string
  file?: string
  line?: number
  snippet?: string
  ruleId?: string
}

/** A manual triage decision persisted per account */
export interface FindingOverride {
  status: 'open' | 'dismissed' | 'resolved'
  note?: string
}

/** Evaluation outcome for a single rule across the whole commit diff. */
export interface RuleResult {
  ruleId: string
  owaspId: string
  title: string
  severity: Severity
  /** Number of files whose paths this rule applied to */
  filesChecked: number
  /** Added lines the rule's pattern was evaluated against */
  linesChecked: number
  /** Number of matches (findings) produced */
  hits: number
}

/** Per-file scan record explaining what was (or wasn't) analyzed. */
export interface FileScan {
  filename: string
  scanned: boolean
  /** Reason the file was skipped, when scanned is false */
  skipReason?: 'no-diff' | 'removed' | 'no-applicable-rules'
  addedLines: number
  commentLinesSkipped: number
  rulesApplied: number
  hits: number
  /** Truncated unified diff, kept for AI review context */
  patch?: string
}

export type AiVerdictKind = 'confirmed' | 'false-positive' | 'uncertain'

export interface AiFindingVerdict {
  /** Index into AnalysisReport.findings */
  findingIndex: number
  verdict: AiVerdictKind
  explanation: string
  suggestedAction?: string
}

/** A structured issue the AI spotted that the pattern rules did not flag */
export interface AiAdditionalFinding {
  title: string
  severity: Severity
  owaspId?: string
  file?: string
  line?: number
  explanation: string
  suggestedAction?: string
}

/** Result of an AI (Claude) triage pass over a commit's findings and diff. */
export interface AiReview {
  summary: string
  /** Narrative-only assessment; commit status derives from findings, not this */
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  verdicts: AiFindingVerdict[]
  /** Issues the AI spotted that the pattern rules did not flag */
  additionalFindings: AiAdditionalFinding[]
  /** Dependency-graph context that was supplied to the model, if available */
  impactContext?: string
  model: string
  reviewedAt: string
}

/** Full evidence trail for one commit's compliance analysis. */
export interface AnalysisReport {
  findings: Finding[]
  ruleResults: RuleResult[]
  fileScans: FileScan[]
  totalLinesChecked: number
  totalRulesEvaluated: number
  analyzedAt: string
}

export interface AnalyzedCommit {
  sha: string
  branch: string
  message: string
  author: string
  authorAvatar?: string
  date: string
  url: string
  status: CommitStatus
  findings: Finding[]
  report?: AnalysisReport
  filesChanged: number
  additions: number
  deletions: number
  error?: string
}

export interface RepoInfo {
  owner: string
  repo: string
  fullName: string
  description: string | null
  defaultBranch: string
  private: boolean
  htmlUrl: string
}

export interface BranchInfo {
  name: string
  headSha: string
  protected: boolean
}

export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt: Date
}
