import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { GitHubError, GitLabClient } from '@fydo/core'
import type { GitHubClient, GitProvider, RepoListItem } from '@fydo/core'
import type { RepoRow } from '../db'

interface Props {
  /** GitHub client for listing the signed-in user's repos */
  client: GitHubClient
  /** GitLab client; authenticated when the user has connected a token */
  gitlabClient: GitLabClient
  /** True when a GitLab personal access token is stored */
  gitlabConnected: boolean
  /** Store (or clear, with null) the GitLab personal access token */
  onGitlabToken: (token: string | null) => void
  /** Repos this account has already onboarded (from Supabase) */
  savedRepos: RepoRow[]
  connecting: boolean
  error: string | null
  onSelect: (provider: GitProvider, fullName: string) => void
  /** GitHub rejected the provider token; the app should prompt a re-sign-in */
  onAuthError: () => void
}

/** One discovered repo with the host it came from */
type DiscoveredRepo = RepoListItem & { provider: GitProvider }

/** Accepts "owner/repo", GitHub URLs, and GitLab URLs (which may have
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

/** Paste-a-token form for GitLab. Validates the token against /user before
 * storing it, so a typo doesn't silently break private-project discovery. */
function GitLabConnect({
  connected,
  onToken,
  loadError,
}: {
  connected: boolean
  onToken: (token: string | null) => void
  loadError: string | null
}) {
  const [tokenInput, setTokenInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [validateError, setValidateError] = useState<string | null>(null)

  async function handleConnect(e: FormEvent) {
    e.preventDefault()
    const token = tokenInput.trim()
    if (!token) return
    setValidating(true)
    setValidateError(null)
    try {
      await new GitLabClient(token).getUser()
      onToken(token)
      setTokenInput('')
    } catch (err) {
      setValidateError(
        err instanceof GitHubError && err.status === 401
          ? 'GitLab rejected this token. Check that it has the read_api scope and is not expired.'
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setValidating(false)
    }
  }

  if (connected) {
    return (
      <div className="connect-section">
        <label>GitLab</label>
        <p className="hint">
          GitLab is connected — your private projects are listed above.{' '}
          <button type="button" className="link-btn" onClick={() => onToken(null)}>
            Disconnect
          </button>
        </p>
        {loadError && <div className="error-banner">{loadError}</div>}
      </div>
    )
  }

  return (
    <form onSubmit={handleConnect} className="connect-section">
      <label>
        Connect GitLab (optional)
        <input
          type="password"
          placeholder="GitLab personal access token (read_api scope)"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          autoComplete="off"
        />
      </label>
      <p className="hint">
        Lists your private GitLab projects alongside GitHub. Create a token with the{' '}
        <span className="mono">read_api</span> scope at{' '}
        <a
          href="https://gitlab.com/-/user_settings/personal_access_tokens"
          target="_blank"
          rel="noreferrer"
        >
          gitlab.com → Access tokens
        </a>
        . The token stays in this browser.
      </p>
      {validateError && <div className="error-banner">{validateError}</div>}
      <button type="submit" className="btn" disabled={validating || !tokenInput.trim()}>
        {validating ? 'Checking token…' : 'Connect GitLab'}
      </button>
    </form>
  )
}

export function RepoStep({
  client,
  gitlabClient,
  gitlabConnected,
  onGitlabToken,
  savedRepos,
  connecting,
  error,
  onSelect,
  onAuthError,
}: Props) {
  const [repos, setRepos] = useState<RepoListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gitlabRepos, setGitlabRepos] = useState<RepoListItem[] | null>(null)
  const [gitlabLoadError, setGitlabLoadError] = useState<string | null>(null)
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

  useEffect(() => {
    if (!gitlabConnected) {
      setGitlabRepos(null)
      setGitlabLoadError(null)
      return
    }
    let cancelled = false
    gitlabClient
      .getUserProjects()
      .then((list) => {
        if (!cancelled) setGitlabRepos(list)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setGitlabRepos([])
        if (e instanceof GitHubError && e.status === 401) {
          // Expired/revoked PAT: drop it so the connect form comes back.
          onGitlabToken(null)
          setGitlabLoadError('Your GitLab token expired or was revoked. Reconnect with a new one.')
          return
        }
        setGitlabLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [gitlabClient, gitlabConnected, onGitlabToken])

  const onboarded = useMemo(
    () => savedRepos.filter((r) => r.onboardedAt !== null),
    [savedRepos],
  )

  /** GitHub and GitLab merged into one list, most recently active first */
  const discovered = useMemo<DiscoveredRepo[]>(() => {
    const all: DiscoveredRepo[] = [
      ...(repos ?? []).map((r) => ({ ...r, provider: 'github' as const })),
      ...(gitlabRepos ?? []).map((r) => ({ ...r, provider: 'gitlab' as const })),
    ]
    return all.sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
  }, [repos, gitlabRepos])

  const filteredRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase()
    return q ? discovered.filter((r) => r.fullName.toLowerCase().includes(q)) : discovered
  }, [discovered, repoFilter])

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseManualInput(manualInput)
    if (!parsed) {
      setManualError(
        'Enter a GitHub repo as owner/repo (or its URL), or a GitLab project URL.',
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
        {gitlabConnected && gitlabRepos === null && (
          <p className="muted small-text">Loading your GitLab projects…</p>
        )}
        {loadError && <div className="error-banner">{loadError}</div>}
        {discovered.length > 0 && (
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
                <li key={`${r.provider}:${r.fullName}`}>
                  <button
                    type="button"
                    className="repo-row"
                    onClick={() => onSelect(r.provider, r.fullName)}
                    disabled={connecting}
                  >
                    <span className="repo-row-name mono">{r.fullName}</span>
                    {r.provider === 'gitlab' && (
                      <span className="badge neutral small">gitlab</span>
                    )}
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

      <GitLabConnect
        connected={gitlabConnected}
        onToken={onGitlabToken}
        loadError={gitlabLoadError}
      />

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
        <p className="hint">
          Public GitLab projects work without a token; private ones need GitLab connected above.
        </p>
        {manualError && <div className="error-banner">{manualError}</div>}
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" className="btn primary" disabled={connecting || !manualInput.trim()}>
          {connecting ? 'Connecting…' : 'Continue'}
        </button>
      </form>
    </>
  )
}
