export type Severity = 'critical' | 'high' | 'medium' | 'low'

/** A rule grouping within a compliance framework: an OWASP Top 10 category
 * (e.g. "A03 Injection") or a MISRA C section (e.g. "M21 Standard libraries"). */
export interface ComplianceCategory {
  id: string // e.g. "A01" or "M21"
  code: string // e.g. "A01:2021" or "Sec 21"
  name: string
  description: string
}

/** @deprecated Historical name; categories are framework-neutral now. */
export type OwaspCategory = ComplianceCategory

export interface ComplianceRule {
  id: string
  /** Category id within the rule's framework. Named for the original OWASP
   * framework; kept as-is because it is persisted in Supabase and Neo4j. */
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

/** A selectable compliance baseline: its rule set plus the scanning behavior
 * that differs between baselines. The AI review prompt for each framework
 * lives server-side (packages/server/src/ai.ts). */
export interface ComplianceFramework {
  /** Persisted id, e.g. "owasp-top-10-2021" */
  id: string
  /** Display name, e.g. "MISRA C:2012" */
  name: string
  /** Short label for inline UI copy, e.g. "OWASP Top 10" */
  shortName: string
  categories: ComplianceCategory[]
  rules: ComplianceRule[]
  /** Matches pure comment lines, which the scanner skips. Language-specific:
   * '#' starts a comment in scripting languages but a preprocessor directive
   * in C, where MISRA rules must see those lines. */
  commentLinePattern: RegExp
  /** Files that rules without their own filePattern apply to. Absent = the
   * broad polyglot default (code extensions + extensionless scripts). */
  fileFilter?: RegExp
}

export interface Finding {
  ruleId: string
  /** Category id within the framework the commit was analyzed under */
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
  /** The AI's risk category for the commit, shown in the review panel. The
   * needs-review / requires-action flags still derive from findings, not this. */
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

/** Git hosting provider a repo lives on */
export type GitProvider = 'github' | 'gitlab'

export interface RepoInfo {
  provider: GitProvider
  /** Namespace part of the path; may contain slashes on GitLab (group/subgroup) */
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
