import { useState } from 'react'
import { OWASP_CATEGORIES, categoryById } from '../compliance/owasp'
import type { AnalysisReport, AnalyzedCommit, CommitStatus, FileScan, Finding } from '../types'

const STATUS_LABEL: Record<CommitStatus, string> = {
  pass: 'Compliant',
  warn: 'Warnings',
  fail: 'Violations',
  analyzing: 'Analyzing…',
  error: 'Error',
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
                {rules.map((r) => (
                  <li key={r.ruleId} className={r.hits > 0 ? 'rule-hit' : ''}>
                    <span className={`evidence-mark small ${r.filesChecked === 0 ? 'na' : r.hits > 0 ? 'fail' : 'pass'}`}>
                      {r.filesChecked === 0 ? '–' : r.hits > 0 ? '✗' : '✓'}
                    </span>
                    <span className="mono rule-id">{r.ruleId}</span>
                    <span className="rule-title">{r.title}</span>
                    <span className="muted small-text">
                      {r.filesChecked === 0
                        ? 'no matching files'
                        : `${r.linesChecked} line${r.linesChecked === 1 ? '' : 's'} in ${r.filesChecked} file${r.filesChecked === 1 ? '' : 's'}${r.hits > 0 ? ` · ${r.hits} match${r.hits === 1 ? '' : 'es'}` : ''}`}
                    </span>
                  </li>
                ))}
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

function EvidencePanel({ commit }: { commit: AnalyzedCommit }) {
  const report = commit.report
  if (!report) return null

  const scannedFiles = report.fileScans.filter((f) => f.scanned).length

  return (
    <div className="evidence">
      <p className="evidence-summary">
        {commit.status === 'pass' ? (
          <>
            <strong>Why this commit is compliant:</strong> {report.totalLinesChecked} added line
            {report.totalLinesChecked === 1 ? '' : 's'} across {scannedFiles} file
            {scannedFiles === 1 ? '' : 's'} were evaluated against {report.totalRulesEvaluated}{' '}
            applicable OWASP Top 10 rule{report.totalRulesEvaluated === 1 ? '' : 's'}, with zero
            matches.
          </>
        ) : (
          <>
            <strong>Evidence:</strong> {report.totalLinesChecked} added line
            {report.totalLinesChecked === 1 ? '' : 's'} across {scannedFiles} file
            {scannedFiles === 1 ? '' : 's'} evaluated against {report.totalRulesEvaluated} applicable
            rule{report.totalRulesEvaluated === 1 ? '' : 's'} — {report.findings.length} match
            {report.findings.length === 1 ? '' : 'es'} found.
          </>
        )}{' '}
        <span className="muted">Analyzed {new Date(report.analyzedAt).toLocaleString()}.</span>
      </p>

      {report.findings.length > 0 && (
        <>
          <h3 className="evidence-heading">Findings ({report.findings.length})</h3>
          <div className="findings">
            {report.findings.map((f, i) => (
              <FindingRow key={`${f.ruleId}-${f.file}-${f.line}-${i}`} finding={f} />
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

function CommitCard({ commit }: { commit: AnalyzedCommit }) {
  const [open, setOpen] = useState(false)
  const clickable = commit.report != null

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
      {open && <EvidencePanel commit={commit} />}
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
