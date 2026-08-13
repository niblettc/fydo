import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { GitHubError } from '@fydo/core'
import type { GitHubClient, GitProvider, RepoListItem } from '@fydo/core'
import type { RepoRow } from '../db'

interface Props {
  /** GitHub client for listing the signed-in user's repos */
  client: GitHubClient
  /** Repos this account has already onboarded (from Supabase) */
  savedRepos: RepoRow[]
  connecting: boolean
  error: string | null
  onSelect: (provider: GitProvider, fullName: string) => void
  /** GitHub rejected the provider token; the app should prompt a re-sign-in */
  onAuthError: () => void
}

/** Accepts "owner/repo", GitHub URLs, and public GitLab URLs (which may have
 * nested namespaces like group/subgroup/project). */
function parseManualInput(input: string): { provider: GitProvider; fullName: string } | null {
  const cleaned = input.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const gitlab = cleaned.match(/^https?:\/\/gitlab\.com\/(.+)$/)
  if (gitlab) {
    // Strip in-project paths like /-/tree/main that come along when copying URLs
    const path = gitlab[1].split('/-/')[0].replace(/\/+$/, '')
    return path.includes('/') ? { provider: 'gitlab', fullName: path } : null
  }
  const path = cleaned.replace(/^https?:\/\/github\.com\//, '')
  const parts = path.split('/')
  return parts.length === 2 && parts[0] && parts[1]
    ? { provider: 'github', fullName: path }
    : null
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
  const [manualError, setManualError] = useState<string | null>(null)

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

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseManualInput(manualInput)
    if (!parsed) {
      setManualError(
        'Enter a GitHub repo as owner/repo (or its URL), or a public GitLab project URL.',
      )
      return
    }
    setManualError(null)
    onSelect(parsed.provider, parsed.fullName)
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
                  onClick={() => onSelect(r.provider, r.fullName)}
                  disabled={connecting}
                >
                  <span className="repo-row-name mono">{r.fullName}</span>
                  {r.provider === 'gitlab' && <span className="badge neutral small">gitlab</span>}
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
                    onClick={() => onSelect('github', r.fullName)}
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
            placeholder="owner/repo, https://github.com/… or https://gitlab.com/…"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
          />
        </label>
        <p className="hint">GitLab support covers public projects (no GitLab sign-in needed).</p>
        {manualError && <div className="error-banner">{manualError}</div>}
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" className="btn primary" disabled={connecting || !manualInput.trim()}>
          {connecting ? 'Connecting…' : 'Continue'}
        </button>
      </form>
    </>
  )
}
