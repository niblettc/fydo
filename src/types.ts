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
