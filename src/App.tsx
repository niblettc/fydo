import { useMemo, useState } from 'react'
import './App.css'
import { BaselinePanel } from './components/BaselinePanel'
import { BranchPicker } from './components/BranchPicker'
import { CommitFeed } from './components/CommitFeed'
import { ConnectPanel } from './components/ConnectPanel'
import { GitHubClient } from './github'
import { useMonitor } from './hooks/useMonitor'
import type { BranchInfo, RateLimitInfo, RepoInfo } from './types'

const POLL_OPTIONS = [30, 60, 120, 300]

export default function App() {
  const [client, setClient] = useState<GitHubClient | null>(null)
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [pollInterval, setPollInterval] = useState(60)

  const monitor = useMonitor(client, repo, selectedBranches, pollInterval)

  async function connect({ token, owner, repo: repoName }: { token: string; owner: string; repo: string }) {
    setConnecting(true)
    setConnectError(null)
    const gh = new GitHubClient(token)
    gh.onRateLimit = setRateLimit
    try {
      const info = await gh.getRepo(owner, repoName)
      const branchList = await gh.getBranches(owner, repoName)
      setClient(gh)
      setRepo(info)
      setBranches(branchList)
      setSelectedBranches([info.defaultBranch])
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  function disconnect() {
    setClient(null)
    setRepo(null)
    setBranches([])
    setSelectedBranches([])
    setRateLimit(null)
  }

  const stats = useMemo(() => {
    const done = monitor.commits.filter((c) => c.status !== 'analyzing' && c.status !== 'error')
    return {
      analyzed: done.length,
      compliant: done.filter((c) => c.status === 'pass').length,
      violations: monitor.commits.reduce(
        (n, c) => n + c.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
        0,
      ),
      warnings: monitor.commits.reduce(
        (n, c) => n + c.findings.filter((f) => f.severity === 'medium' || f.severity === 'low').length,
        0,
      ),
    }
  }, [monitor.commits])

  if (!client || !repo) {
    return <ConnectPanel connecting={connecting} error={connectError} onConnect={connect} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">⬢</span>
          <div>
            <div className="repo-name">
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                {repo.fullName}
              </a>
              {repo.private && <span className="badge neutral small">private</span>}
            </div>
            <div className="muted small-text">
              {monitor.polling
                ? 'Polling…'
                : monitor.lastPolledAt
                  ? `Last checked ${monitor.lastPolledAt.toLocaleTimeString()}`
                  : 'Waiting for first poll'}
              {' · '}every
              <select
                className="inline-select"
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
              >
                {POLL_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s >= 60 ? `${s / 60}m` : `${s}s`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          {rateLimit && (
            <span
              className={`muted small-text ${rateLimit.remaining < 20 ? 'rate-low' : ''}`}
              title={`Resets at ${rateLimit.resetAt.toLocaleTimeString()}`}
            >
              API {rateLimit.remaining}/{rateLimit.limit}
            </span>
          )}
          <button className="btn" onClick={monitor.refresh} disabled={monitor.polling}>
            Check now
          </button>
          <button className="btn subtle" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </header>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-value">{stats.analyzed}</div>
          <div className="stat-label">Commits analyzed</div>
        </div>
        <div className="stat pass">
          <div className="stat-value">{stats.compliant}</div>
          <div className="stat-label">Compliant</div>
        </div>
        <div className="stat fail">
          <div className="stat-value">{stats.violations}</div>
          <div className="stat-label">High/critical findings</div>
        </div>
        <div className="stat warn">
          <div className="stat-value">{stats.warnings}</div>
          <div className="stat-label">Medium/low findings</div>
        </div>
      </div>

      {monitor.error && <div className="error-banner wide">{monitor.error}</div>}

      <main className="layout">
        <aside className="sidebar">
          <BranchPicker
            branches={branches}
            selected={selectedBranches}
            defaultBranch={repo.defaultBranch}
            onChange={setSelectedBranches}
          />
          <BaselinePanel commits={monitor.commits} />
        </aside>
        <CommitFeed commits={monitor.commits} hasBranches={selectedBranches.length > 0} />
      </main>
    </div>
  )
}
