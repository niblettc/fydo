import { useState } from 'react'
import { blobUrlFromCommitUrl, categoryById } from '@fydo/core'
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

const SOURCE_TOOLTIP: Record<FindingSource, string> = {
  rules: 'Flagged by the regex rule scanner',
  ai: 'Discovered by the AI security review',
  both: 'Flagged by the rule scanner and confirmed by the AI review',
}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Requires action',
  'needs-review': 'Needs review',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
}

const STATUS_TOOLTIP: Record<FindingStatus, string> = {
  open: 'Confirmed issue that needs a code change',
  'needs-review': 'Awaiting confirmation by a human or the AI review',
  dismissed: 'Triaged as a false positive or not applicable',
  resolved: 'Fixed or otherwise addressed',
}

interface Props {
  finding: UnifiedFinding
  sha: string
  onTriage: TriageFn
  /** Commit context, shown when the card lives outside its commit (findings feed) */
  context?: { commit: AnalyzedCommit; branches: string[] }
  /** Commit HTML URL, used to link file:line to the code host when no context is given */
  commitUrl?: string
}

export function FindingCard({ finding, sha, onTriage, context, commitUrl }: Props) {
  const [expanded, setExpanded] = useState(false)
  const category = finding.owaspId ? categoryById(finding.owaspId) : undefined
  const inactive = finding.status === 'dismissed' || finding.status === 'resolved'
  /** Synthetic commit-level rating emitted when a risky review has no itemized findings */
  const isRiskAssessment = finding.id.endsWith(':ai-risk')

  const location = finding.file
    ? `${finding.file}${finding.line != null ? `:${finding.line}` : ''}`
    : undefined
  const sourceUrl = context?.commit.url ?? commitUrl
  const codeUrl =
    finding.file && sourceUrl
      ? blobUrlFromCommitUrl(sourceUrl, sha, finding.file, finding.line)
      : undefined

  return (
    <div
      className={`finding sev-${finding.severity} ${inactive ? 'finding-inactive' : ''} ${expanded ? 'finding-expanded' : ''}`}
    >
      <button
        type="button"
        className="finding-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="finding-title-row">
          <strong className="finding-title">{finding.title}</strong>
          <span className="chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
        <div className="finding-head">
          <span className={`badge sev-${finding.severity}`}>{finding.severity}</span>
          <span className={`badge source-${finding.source}`} title={SOURCE_TOOLTIP[finding.source]}>
            {SOURCE_LABEL[finding.source]}
          </span>
          {isRiskAssessment && (
            <span
              className="badge neutral"
              title="Overall AI risk rating for the commit, not an itemized vulnerability"
            >
              Commit-level
            </span>
          )}
          {category && (
            <span className="badge owasp" title={category.description}>
              {category.code} {category.name}
            </span>
          )}
          <span
            className={`badge fstatus-${finding.status}`}
            title={STATUS_TOOLTIP[finding.status]}
          >
            {FINDING_STATUS_LABEL[finding.status]}
          </span>
        </div>
        {!expanded && (
          <div className="finding-summary">
            {location && <span className="finding-loc-inline">{location}</span>}
            <span className="finding-desc-clamp">{finding.description}</span>
          </div>
        )}
      </button>

      {context && (
        <div className="finding-commit">
          <span className="mono">{context.commit.sha.slice(0, 7)}</span>
          <span className="finding-commit-msg">{context.commit.message}</span>
          <span className="badge neutral small">{context.branches.join(', ')}</span>
          <span>{new Date(context.commit.date).toLocaleDateString()}</span>
          <a href={context.commit.url} target="_blank" rel="noreferrer" title="View commit">
            ↗
          </a>
        </div>
      )}

      {expanded && (
        <div className="finding-body">
          {isRiskAssessment && (
            <p className="finding-callout">
              This is the AI review's overall rating for the commit — it did not itemize a
              specific vulnerability. Re-run the AI review to get discrete findings, or triage
              this rating manually.
            </p>
          )}

          <div className="finding-section">
            <div className="finding-section-label">Why this matters</div>
            <p className="finding-desc">{finding.description}</p>
          </div>

          {(location || finding.snippet || finding.ruleId) && (
            <div className="finding-section">
              <div className="finding-section-label">Evidence</div>
              {location &&
                (codeUrl ? (
                  <a
                    className="finding-loc"
                    href={codeUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View this line on GitHub"
                  >
                    {location} ↗
                  </a>
                ) : (
                  <div className="finding-loc">{location}</div>
                ))}
              {finding.snippet && <pre className="finding-snippet">{finding.snippet}</pre>}
              <p className="finding-meta">
                Detected by {SOURCE_TOOLTIP[finding.source].toLowerCase()}
                {finding.ruleId ? ` (rule ${finding.ruleId})` : ''}.
              </p>
            </div>
          )}

          {finding.remediation && (
            <div className="finding-section">
              <div className="finding-section-label">Recommended fix</div>
              <p className="finding-desc">{finding.remediation}</p>
            </div>
          )}

          {finding.statusReason && (
            <div className="finding-section">
              <div className="finding-section-label">Assessment</div>
              <p className="finding-desc">{finding.statusReason}</p>
            </div>
          )}

          <div className="finding-actions">
            {!inactive && (
              <>
                <button
                  className="btn small-btn"
                  onClick={() => onTriage(sha, finding.id, 'resolved')}
                >
                  Mark resolved
                </button>
                <button
                  className="btn small-btn"
                  onClick={() => onTriage(sha, finding.id, 'dismissed')}
                >
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
      )}
    </div>
  )
}
