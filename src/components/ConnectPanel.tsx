import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { GitHubClient } from '../github'
import type { RepoListItem } from '../github'

interface Props {
  connecting: boolean
  error: string | null
  onConnect: (opts: { token: string; owner: string; repo: string }) => void
}

function pushedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function ConnectPanel({ connecting, error, onConnect }: Props) {
  const [token, setToken] = useState(() => localStorage.getItem('gh_token') ?? '')
  const [repoInput, setRepoInput] = useState('')

  const [user, setUser] = useState<{ login: string; avatarUrl: string } | null>(null)
  const [repos, setRepos] = useState<RepoListItem[] | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [repoFilter, setRepoFilter] = useState('')

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    const q = repoFilter.trim().toLowerCase()
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos
  }, [repos, repoFilter])

  async function discoverRepos() {
    const trimmed = token.trim()
    if (!trimmed) return
    setDiscovering(true)
    setDiscoverError(null)
    setUser(null)
    setRepos(null)
    try {
      const gh = new GitHubClient(trimmed)
      const who = await gh.getUser()
      const list = await gh.getUserRepos()
      localStorage.setItem('gh_token', trimmed)
      setUser(who)
      setRepos(list)
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e))
    } finally {
      setDiscovering(false)
    }
  }

  function handleTokenChange(value: string) {
    setToken(value)
    // Invalidate any previously discovered list when the token changes
    setUser(null)
    setRepos(null)
    setDiscoverError(null)
  }

  function connectTo(owner: string, repo: string) {
    localStorage.setItem('gh_token', token.trim())
    onConnect({ token: token.trim(), owner, repo })
  }

  function handleManualSubmit(e: FormEvent) {
    e.preventDefault()
    const cleaned = repoInput
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
    const [owner, repo] = cleaned.split('/')
    if (!owner || !repo) return
    connectTo(owner, repo)
  }

  return (
    <div className="connect-wrap">
      <div className="connect-card">
        <div className="connect-logo">⬢</div>
        <h1>Commit Sentinel</h1>
        <p className="connect-sub">
          Connect a GitHub repository, watch commits land on the branches you choose, and check
          every change against the OWASP Top 10 compliance baseline.
        </p>

        <div className="connect-section">
          <label>
            Personal access token <span className="muted">(optional for public repos)</span>
            <div className="token-row">
              <input
                type="password"
                placeholder="ghp_… or github_pat_…"
                value={token}
                onChange={(e) => handleTokenChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void discoverRepos()
                  }
                }}
                autoComplete="off"
                autoFocus
              />
              <button
                type="button"
                className="btn primary"
                onClick={() => void discoverRepos()}
                disabled={discovering || !token.trim()}
              >
                {discovering ? 'Loading…' : 'Load my repos'}
              </button>
            </div>
          </label>
          <p className="hint">
            Without a token GitHub allows 60 API requests/hour; with one you get 5,000. The token is
            stored only in your browser's localStorage and sent only to api.github.com.
          </p>
          {discoverError && <div className="error-banner">{discoverError}</div>}
        </div>

        {user && repos && (
          <div className="connect-section">
            <div className="discover-status">
              <img className="avatar" src={user.avatarUrl} alt="" width={18} height={18} />
              <span>
                Authenticated as <strong>{user.login}</strong>
              </span>
              <span className="badge neutral small">{repos.length} repos</span>
            </div>
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
                    onClick={() => connectTo(r.owner, r.repo)}
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
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="connect-section">
          <label>
            {user ? 'Or enter a repository manually' : 'Repository'}
            <input
              type="text"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              required
            />
          </label>
          {error && <div className="error-banner">{error}</div>}
          <button type="submit" className="btn primary" disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect repository'}
          </button>
        </form>
      </div>
    </div>
  )
}
