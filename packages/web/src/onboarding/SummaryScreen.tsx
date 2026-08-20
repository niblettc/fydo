import { mergeFindings } from '@fydo/core'
import type { PreparationResult } from '../hooks/usePreparation'
import type { RepoInfo } from '@fydo/core'

interface Props {
  repo: RepoInfo
  selectedBranches: string[]
  result: PreparationResult
  onContinue: () => void
}

export function SummaryScreen({ repo, selectedBranches, result, onContinue }: Props) {
  const seen = new Set<string>()
  let openFindings = 0
  for (const c of result.commits) {
    if (seen.has(c.sha)) continue
    seen.add(c.sha)
    const unified = mergeFindings(c.sha, c.findings, result.reviews[c.sha])
    openFindings += unified.filter((f) => f.status === 'open').length
  }
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
          <div className={`stat ${openFindings > 0 ? 'warn' : 'pass'}`}>
            <div className="stat-value">{openFindings}</div>
            <div className="stat-label">Open findings</div>
          </div>
        </div>

        <p className="hint">
          {reviewCount} commit{reviewCount === 1 ? '' : 's'} received an AI compliance review during
          setup.
        </p>

        <button type="button" className="btn primary" onClick={onContinue}>
          View dashboard
        </button>
      </div>
    </div>
  )
}
