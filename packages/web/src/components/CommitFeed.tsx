import { useState } from 'react'
import { OWASP_CATEGORIES, categoryById } from '@fydo/core'
import type { AiReviewsState } from '../hooks/useAiReviews'
import type { CommitView } from '../findings'
import { commitView, viewKey } from '../findings'
import type {
  AnalysisReport,
  AnalyzedCommit,
  CommitStatus,
  FileScan,
  FindingOverride,
  FindingSource,
  FindingStatus,
  UnifiedFinding,
} from '@fydo/core'

type TriageFn = (
  sha: string,
  findingId: string,
  status: FindingOverride['status'],
  note?: string,
) => void

const STATUS_LABEL: Record<CommitStatus, string> = {
  clean: 'Clean',
  findings: 'Findings',
  'needs-review': 'Needs review',
  analyzing: 'Analyzing…',
  error: 'Error',
}

const SOURCE_LABEL: Record<FindingSource, string> = {
  rules: 'Rules',
  ai: 'AI',
  both: 'AI + Rules',
}

const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  'needs-review': 'Needs review',
  dismissed: 'Dismissed',
  resolved: 'Resolved',
}

const SKIP_REASON_LABEL: Record<NonNullable<FileScan['skipReason']>, string> = {
  'no-diff': 'no text diff available',
  removed: 'file deleted',
  'no-applicable-rules': 'no rules apply to this file type',
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function commitBadgeText(view: CommitView): string {
  if (view.status === 'findings') {
    const n = view.openCount
    const sev = view.worstSeverity ? ` · ${view.worstSeverity}` : ''
    return `${n} finding${n === 1 ? '' : 's'}${sev}`
  }
  if (view.status === 'needs-review' && view.needsReviewCount > 0) {
    return `Needs review · ${view.needsReviewCount}`
  }
  return STATUS_LABEL[view.status]
}

function FindingRow({
  sha,
  finding,
  onTriage,
}: {
  sha: string
  finding: UnifiedFinding
  onTriage: TriageFn
}) {
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
  )
}

function CategoryEvidence({ report }: { report: AnalysisReport }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  return (
    <div className="evidence-categories">
      {OWASP_CATEGORIES.map((cat) => {
        const rules = report.ruleResults.filter((r) => r.owaspId === cat.id)
        const evaluated = rules.filter((r) => r.filesChecked > 0)
        const hits = rules.reduce((n, r) => n + r.hits, 0)
        const open = openCategory === cat.id
        const state = evaluated.length === 0 ? 'na' : hits > 0 ? 'fail' : 'pass'
        return (
          <div key={cat.id} className={`evidence-cat ${state}`}>
            <button
              className="evidence-cat-head"
              onClick={() => setOpenCategory(open ? null : cat.id)}
              aria-expanded={open}
            >
              <span className={`evidence-mark ${state}`}>
                {state === 'pass' ? '✓' : state === 'fail' ? '✗' : '–'}
              </span>
              <span className="baseline-code">{cat.code}</span>
              <span className="evidence-cat-name">{cat.name}</span>
              <span className="muted small-text">
                {state === 'na'
                  ? 'not applicable to changed files'
                  : hits > 0
                    ? `${hits} match${hits === 1 ? '' : 'es'} from ${evaluated.length} rule${evaluated.length === 1 ? '' : 's'}`
                    : `${evaluated.length} rule${evaluated.length === 1 ? '' : 's'} checked, 0 matches`}
              </span>
              <span className="chevron">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <ul className="evidence-rules">
                {rules.map((r) => {
                  const matches = report.findings.filter((f) => f.ruleId === r.ruleId)
                  return (
                    <li key={r.ruleId} className={r.hits > 0 ? 'rule-hit' : ''}>
                      <div className="evidence-rule-row">
                        <span
                          className={`evidence-mark small ${r.filesChecked === 0 ? 'na' : r.hits > 0 ? 'fail' : 'pass'}`}
                        >
                          {r.filesChecked === 0 ? '–' : r.hits > 0 ? '✗' : '✓'}
                        </span>
                        <span className="mono rule-id">{r.ruleId}</span>
                        <span className="rule-title">{r.title}</span>
                        <span className="muted small-text">
                          {r.filesChecked === 0
                            ? 'no matching files'
                            : `${r.linesChecked} line${r.linesChecked === 1 ? '' : 's'} in ${r.filesChecked} file${r.filesChecked === 1 ? '' : 's'}${r.hits > 0 ? ` · ${r.hits} match${r.hits === 1 ? '' : 'es'}` : ''}`}
                        </span>
                      </div>
                      {matches.length > 0 && (
                        <ul className="rule-matches">
                          {matches.map((m, i) => (
                            <li key={`${m.file}-${m.line}-${i}`}>
                              <span className="mono finding-loc">
                                {m.file}:{m.line}
                              </span>
                              <pre className="finding-snippet compact">{m.snippet}</pre>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FileScanList({ scans }: { scans: FileScan[] }) {
  return (
    <ul className="evidence-files">
      {scans.map((f) => (
        <li key={f.filename} className={f.scanned ? '' : 'file-skipped'}>
          <span className={`evidence-mark small ${f.scanned ? (f.hits > 0 ? 'fail' : 'pass') : 'na'}`}>
            {f.scanned ? (f.hits > 0 ? '✗' : '✓') : '–'}
          </span>
          <span className="mono file-name">{f.filename}</span>
          <span className="muted small-text">
            {f.scanned
              ? `${f.addedLines} added line${f.addedLines === 1 ? '' : 's'} × ${f.rulesApplied} rules` +
                (f.commentLinesSkipped > 0 ? ` (${f.commentLinesSkipped} comment lines skipped)` : '') +
                (f.hits > 0 ? ` · ${f.hits} match${f.hits === 1 ? '' : 'es'}` : '')
              : `skipped — ${SKIP_REASON_LABEL[f.skipReason ?? 'no-diff']}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AiSummarySection({ commit, ai }: { commit: AnalyzedCommit; ai: AiReviewsState }) {
  const review = ai.reviews[commit.sha]
  const running = ai.running[commit.sha] ?? false
  const error = ai.errors[commit.sha]

  return (
    <div className="ai-section">
      <div className="ai-section-head">
        <h3 className="evidence-heading">AI review</h3>
        <button className="btn small-btn" onClick={() => ai.run(commit)} disabled={running}>
          {running ? 'Reviewing…' : review ? 'Re-run' : 'Run AI review'}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {running && !review && (
        <p className="muted small-text">Claude is reviewing the diff and findings…</p>
      )}
      {review && (
        <div className="ai-review-body">
          <p className="ai-summary">{review.summary}</p>
          {review.impactContext && (
            <details className="impact-details">
              <summary>Dependency-graph context used in this review</summary>
              <pre className="impact-context">{review.impactContext}</pre>
            </details>
          )}
          <p className="muted small-text">
            {review.model} · reviewed {new Date(review.reviewedAt).toLocaleString()} · saved to
            your account{review.impactContext ? ' · graph-aware' : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function EvidencePanel({
  commit,
  view,
  ai,
  onTriage,
}: {
  commit: AnalyzedCommit
  view: CommitView
  ai: AiReviewsState
  onTriage: TriageFn
}) {
  const report = commit.report
  if (!report) return null

  const scannedFiles = report.fileScans.filter((f) => f.scanned).length
  const active = view.findings.filter((f) => f.status === 'open' || f.status === 'needs-review')
  const inactive = view.findings.filter((f) => f.status === 'dismissed' || f.status === 'resolved')

  return (
    <div className="evidence">
      <p className="evidence-summary">
        {view.status === 'clean' ? (
          <>
            <strong>Why this commit is clean:</strong> {report.totalLinesChecked} added line
            {report.totalLinesChecked === 1 ? '' : 's'} across {scannedFiles} file
            {scannedFiles === 1 ? '' : 's'} were evaluated against {report.totalRulesEvaluated}{' '}
            applicable OWASP Top 10 rule{report.totalRulesEvaluated === 1 ? '' : 's'}
            {view.reviewed ? ' and AI-reviewed' : ''}, with no open findings.
          </>
        ) : (
          <>
            <strong>Evidence:</strong> {report.totalLinesChecked} added line
            {report.totalLinesChecked === 1 ? '' : 's'} across {scannedFiles} file
            {scannedFiles === 1 ? '' : 's'} evaluated against {report.totalRulesEvaluated} applicable
            rule{report.totalRulesEvaluated === 1 ? '' : 's'}
            {view.reviewed ? ' plus an AI review' : ''} — {active.length} finding
            {active.length === 1 ? '' : 's'} need{active.length === 1 ? 's' : ''} attention.
          </>
        )}{' '}
        <span className="muted">Analyzed {new Date(report.analyzedAt).toLocaleString()}.</span>
      </p>

      <AiSummarySection commit={commit} ai={ai} />

      {active.length > 0 && (
        <>
          <h3 className="evidence-heading">Findings ({active.length})</h3>
          <div className="findings">
            {active.map((f) => (
              <FindingRow key={f.id} sha={commit.sha} finding={f} onTriage={onTriage} />
            ))}
          </div>
        </>
      )}

      {inactive.length > 0 && (
        <>
          <h3 className="evidence-heading">Dismissed & resolved ({inactive.length})</h3>
          <div className="findings">
            {inactive.map((f) => (
              <FindingRow key={f.id} sha={commit.sha} finding={f} onTriage={onTriage} />
            ))}
          </div>
        </>
      )}

      <h3 className="evidence-heading">Rule evaluation by OWASP category</h3>
      <CategoryEvidence report={report} />

      <h3 className="evidence-heading">Files in this commit ({report.fileScans.length})</h3>
      <FileScanList scans={report.fileScans} />
    </div>
  )
}

function CommitCard({
  commit,
  view,
  ai,
  onTriage,
}: {
  commit: AnalyzedCommit
  view: CommitView
  ai: AiReviewsState
  onTriage: TriageFn
}) {
  const [open, setOpen] = useState(false)
  const clickable = commit.report != null

  return (
    <li className={`commit-card status-${view.status}`}>
      <button
        className="commit-summary"
        onClick={() => clickable && setOpen((o) => !o)}
        aria-expanded={open}
        style={{ cursor: clickable ? 'pointer' : 'default' }}
      >
        <span className={`status-dot ${view.status}`} />
        <div className="commit-main">
          <div className="commit-msg">{commit.message}</div>
          <div className="commit-meta">
            {commit.authorAvatar && (
              <img className="avatar" src={commit.authorAvatar} alt="" width={16} height={16} />
            )}
            <span>{commit.author}</span>
            <span className="sep">·</span>
            <span className="mono">{commit.sha.slice(0, 7)}</span>
            <span className="sep">·</span>
            <span className="badge neutral small">{commit.branch}</span>
            <span className="sep">·</span>
            <span>{timeAgo(commit.date)}</span>
            {commit.status !== 'analyzing' && commit.status !== 'error' && (
              <>
                <span className="sep">·</span>
                <span className="muted">
                  {commit.filesChanged} files, +{commit.additions} −{commit.deletions}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="commit-status">
          <span className={`badge status-${view.status}`}>{commitBadgeText(view)}</span>
          {clickable && <span className="chevron">{open ? '▾' : '▸'}</span>}
        </div>
      </button>
      {commit.status === 'error' && <div className="commit-error">{commit.error}</div>}
      {open && <EvidencePanel commit={commit} view={view} ai={ai} onTriage={onTriage} />}
      <a
        className="commit-link"
        href={commit.url}
        target="_blank"
        rel="noreferrer"
        title="View on GitHub"
      >
        ↗
      </a>
    </li>
  )
}

interface Props {
  commits: AnalyzedCommit[]
  hasBranches: boolean
  ai: AiReviewsState
  views: Map<string, CommitView>
  onTriage: TriageFn
}

export function CommitFeed({ commits, hasBranches, ai, views, onTriage }: Props) {
  const sorted = [...commits].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )
  return (
    <section className="panel feed">
      <div className="panel-header">
        <h2>Commit feed</h2>
        <span className="badge neutral">{commits.length} analyzed</span>
      </div>
      {!hasBranches && (
        <p className="muted empty-row">Select one or more branches to start monitoring.</p>
      )}
      {hasBranches && commits.length === 0 && (
        <p className="muted empty-row">Fetching commits…</p>
      )}
      <ul className="commit-list">
        {sorted.map((c) => (
          <CommitCard
            key={viewKey(c)}
            commit={c}
            view={views.get(viewKey(c)) ?? commitView(c, ai.reviews[c.sha], {})}
            ai={ai}
            onTriage={onTriage}
          />
        ))}
      </ul>
    </section>
  )
}
