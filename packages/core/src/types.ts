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

export type CommitStatus = 'pass' | 'warn' | 'fail' | 'analyzing' | 'error'

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

/** Result of an AI (Claude) triage pass over a commit's findings and diff. */
export interface AiReview {
  summary: string
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  verdicts: AiFindingVerdict[]
  /** Issues the AI spotted that the pattern rules did not flag */
  additionalObservations: string[]
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
