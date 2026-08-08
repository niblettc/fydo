import { useState } from 'react'
import { categoryById } from '../compliance/owasp'
import type { AnalyzedCommit, CommitStatus, Finding } from '../types'

const STATUS_LABEL: Record<CommitStatus, string> = {
  pass: 'Compliant',
  warn: 'Warnings',
  fail: 'Violations',
  analyzing: 'Analyzing…',
  error: 'Error',
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function FindingRow({ finding }: { finding: Finding }) {
  const category = categoryById(finding.owaspId)
  return (
    <div className={`finding sev-${finding.severity}`}>
      <div className="finding-head">
        <span className={`badge sev-${finding.severity}`}>{finding.severity}</span>
        <span className="badge owasp">
          {category ? `${category.code} ${category.name}` : finding.owaspId}
        </span>
        <strong>{finding.title}</strong>
      </div>
      <div className="finding-loc">
        {finding.file}:{finding.line}
      </div>
      <pre className="finding-snippet">{finding.snippet}</pre>
      <p className="finding-desc">{finding.description}</p>
      <p className="finding-fix">
        <strong>Fix:</strong> {finding.remediation}
      </p>
    </div>
  )
}

function CommitCard({ commit }: { commit: AnalyzedCommit }) {
  const [open, setOpen] = useState(false)
  const clickable = commit.findings.length > 0

  return (
    <li className={`commit-card status-${commit.status}`}>
      <button
        className="commit-summary"
        onClick={() => clickable && setOpen((o) => !o)}
        aria-expanded={open}
        style={{ cursor: clickable ? 'pointer' : 'default' }}
      >
        <span className={`status-dot ${commit.status}`} />
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
          <span className={`badge status-${commit.status}`}>
            {STATUS_LABEL[commit.status]}
            {commit.findings.length > 0 && ` · ${commit.findings.length}`}
          </span>
          {clickable && <span className="chevron">{open ? '▾' : '▸'}</span>}
        </div>
      </button>
      {commit.status === 'error' && <div className="commit-error">{commit.error}</div>}
      {open && (
        <div className="findings">
          {commit.findings.map((f, i) => (
            <FindingRow key={`${f.ruleId}-${f.file}-${f.line}-${i}`} finding={f} />
          ))}
        </div>
      )}
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
}

export function CommitFeed({ commits, hasBranches }: Props) {
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
          <CommitCard key={`${c.branch}:${c.sha}`} commit={c} />
        ))}
      </ul>
    </section>
  )
}
