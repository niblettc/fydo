import type { PreparationResult } from '../hooks/usePreparation'
import type { RepoInfo } from '@fydo/core'

interface Props {
  repo: RepoInfo
  selectedBranches: string[]
  result: PreparationResult
  onContinue: () => void
}

export function SummaryScreen({ repo, selectedBranches, result, onContinue }: Props) {
  const findings = result.commits.reduce((n, c) => n + c.findings.length, 0)
  const reviewCount = Object.keys(result.reviews).length

  return (
    <div className="connect-wrap">
      <div className="connect-card wizard-card">
        <div className="connect-logo">⬢</div>
        <h1>{repo.fullName} is ready</h1>
        <p className="connect-sub">
          Setup is complete. New commits on your selected branches will be analyzed and
          AI-reviewed automatically from here on.
        </p>

        <div className="summary-grid">
          <div className="stat">
            <div className="stat-value">{selectedBranches.length}</div>
            <div className="stat-label">
              Branch{selectedBranches.length === 1 ? '' : 'es'} monitored
            </div>
          </div>
          <div className="stat">
            <div className="stat-value">{result.graphStats?.files ?? 0}</div>
            <div className="stat-label">Files in dependency graph</div>
          </div>
          <div className="stat">
            <div className="stat-value">{result.commits.length}</div>
            <div className="stat-label">Commits analyzed</div>
          </div>
          <div className={`stat ${findings > 0 ? 'warn' : 'pass'}`}>
            <div className="stat-value">{findings}</div>
            <div className="stat-label">Initial findings</div>
          </div>
        </div>

        <p className="hint">
          {reviewCount} commit{reviewCount === 1 ? '' : 's'} received an AI security review during
          setup.
        </p>

        <button type="button" className="btn primary" onClick={onContinue}>
          View dashboard
        </button>
      </div>
    </div>
  )
}
