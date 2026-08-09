import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { GitHubError } from '@fydo/core'
import type { GitHubClient, RepoListItem } from '@fydo/core'
import type { RepoRow } from '../db'

interface Props {
  client: GitHubClient
  /** Repos this account has already onboarded (from Supabase) */
  savedRepos: RepoRow[]
  connecting: boolean
  error: string | null
  onSelect: (owner: string, repo: string) => void
  /** GitHub rejected the provider token; the app should prompt a re-sign-in */
  onAuthError: () => void
}

function pushedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function RepoStep({ client, savedRepos, connecting, error, onSelect, onAuthError }: Props) {
  const [repos, setRepos] = useState<RepoListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [repoFilter, setRepoFilter] = useState('')
  const [manualInput, setManualInput] = useState('')

  useEffect(() => {
    let cancelled = false
    client
      .getUserRepos()
      .then((list) => {
        if (!cancelled) setRepos(list)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof GitHubError && e.status === 401) {
          onAuthError()
          return
        }
        setLoadError(e instanceof Error ? e.message : String(e))
        setRepos([])
      })
    return () => {
      cancelled = true
    }
  }, [client, onAuthError])

  const onboarded = useMemo(
    () => savedRepos.filter((r) => r.onboardedAt !== null),
    [savedRepos],
  )

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    const q = repoFilter.trim().toLowerCase()
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos
  }, [repos, repoFilter])

  function selectFullName(fullName: string) {
    const [owner, repo] = fullName.split('/')
    if (owner && repo) onSelect(owner, repo)
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    const cleaned = manualInput
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
    selectFullName(cleaned)
  }

  return (
    <>
      {onboarded.length > 0 && (
        <div className="connect-section">
          <label>Your monitored repositories</label>
          <ul className="repo-list">
            {onboarded.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="repo-row"
                  onClick={() => selectFullName(r.fullName)}
                  disabled={connecting}
                >
                  <span className="repo-row-name mono">{r.fullName}</span>
                  <span className="badge pass small">monitored</span>
                  <span className="muted small-text repo-row-pushed">
                    {r.selectedBranches.length} branch{r.selectedBranches.length === 1 ? '' : 'es'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Picking a monitored repo takes you straight to its dashboard.</p>
        </div>
      )}

      <div className="connect-section">
        <label>{onboarded.length > 0 ? 'Set up a new repository' : 'Choose a repository'}</label>
        {repos === null && <p className="muted small-text">Loading your repositories…</p>}
        {loadError && <div className="error-banner">{loadError}</div>}
        {repos !== null && repos.length > 0 && (
          <>
            <input
              className="filter-input"
              type="text"
              placeholder="Filter repositories…"
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
            />
            <ul className="repo-list">
              {filteredRepos.map((r) => (
                <li key={r.fullName}>
                  <button
                    type="button"
                    className="repo-row"
                    onClick={() => onSelect(r.owner, r.repo)}
                    disabled={connecting}
                  >
                    <span className="repo-row-name mono">{r.fullName}</span>
                    {r.private && <span className="badge neutral small">private</span>}
                    <span className="muted small-text repo-row-pushed">
                      pushed {pushedAgo(r.pushedAt)}
                    </span>
                  </button>
                </li>
              ))}
              {filteredRepos.length === 0 && (
                <li className="muted empty-row">No repositories match.</li>
              )}
            </ul>
          </>
        )}
      </div>

      <form onSubmit={handleManualSubmit} className="connect-section">
        <label>
          Or enter a repository manually
          <input
            type="text"
            placeholder="owner/repo or https://github.com/owner/repo"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" className="btn primary" disabled={connecting || !manualInput.trim()}>
          {connecting ? 'Connecting…' : 'Continue'}
        </button>
      </form>
    </>
  )
}
