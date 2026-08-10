import { categoryById } from '@fydo/core'
import type {
  AnalyzedCommit,
  FindingOverride,
  FindingSource,
  FindingStatus,
  UnifiedFinding,
} from '@fydo/core'

export type TriageFn = (
  sha: string,
  findingId: string,
  status: FindingOverride['status'],
  note?: string,
) => void

export const SOURCE_LABEL: Record<FindingSource, string> = {
  rules: 'Rules',
  ai: 'AI',
  both: 'AI + Rules',
}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Requires action',
  'needs-review': 'Needs review',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
}

interface Props {
  finding: UnifiedFinding
  sha: string
  onTriage: TriageFn
  /** Commit context, shown when the card lives outside its commit (findings feed) */
  context?: { commit: AnalyzedCommit; branches: string[] }
}

export function FindingCard({ finding, sha, onTriage, context }: Props) {
  const category = finding.owaspId ? categoryById(finding.owaspId) : undefined
  const inactive = finding.status === 'dismissed' || finding.status === 'resolved'

  return (
    <div className={`finding sev-${finding.severity} ${inactive ? 'finding-inactive' : ''}`}>
      <div className="finding-head">
        <span className={`badge sev-${finding.severity}`}>{finding.severity}</span>
        <span className={`badge source-${finding.source}`}>{SOURCE_LABEL[finding.source]}</span>
        {category && (
          <span className="badge owasp">
            {category.code} {category.name}
          </span>
        )}
        <strong>{finding.title}</strong>
        <span className={`badge fstatus-${finding.status}`}>
          {FINDING_STATUS_LABEL[finding.status]}
        </span>
      </div>
      {context && (
        <div className="finding-commit">
          <span className="mono">{context.commit.sha.slice(0, 7)}</span>
          <span className="finding-commit-msg">{context.commit.message}</span>
          <span className="badge neutral small">{context.branches.join(', ')}</span>
          <span>{new Date(context.commit.date).toLocaleDateString()}</span>
          <a href={context.commit.url} target="_blank" rel="noreferrer" title="View on GitHub">
            ↗
          </a>
        </div>
      )}
      {finding.file && (
        <div className="finding-loc">
          {finding.file}
          {finding.line != null ? `:${finding.line}` : ''}
        </div>
      )}
      {finding.snippet && <pre className="finding-snippet">{finding.snippet}</pre>}
      <p className="finding-desc">{finding.description}</p>
      {finding.remediation && (
        <p className="finding-fix">
          <strong>Fix:</strong> {finding.remediation}
        </p>
      )}
      {finding.statusReason && (
        <p className="finding-desc">
          <strong>Assessment:</strong> {finding.statusReason}
        </p>
      )}
      <div className="finding-actions">
        {!inactive && (
          <>
            <button className="btn small-btn" onClick={() => onTriage(sha, finding.id, 'resolved')}>
              Mark resolved
            </button>
            <button className="btn small-btn" onClick={() => onTriage(sha, finding.id, 'dismissed')}>
              Dismiss
            </button>
          </>
        )}
        {inactive && (
          <button className="btn small-btn" onClick={() => onTriage(sha, finding.id, 'open')}>
            Reopen
          </button>
        )}
      </div>
    </div>
  )
}
