import { useState } from 'react'
import type { FormEvent } from 'react'

interface Props {
  connecting: boolean
  error: string | null
  onConnect: (opts: { token: string; owner: string; repo: string }) => void
}

export function ConnectPanel({ connecting, error, onConnect }: Props) {
  const [token, setToken] = useState(() => localStorage.getItem('gh_token') ?? '')
  const [repoInput, setRepoInput] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cleaned = repoInput
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
    const [owner, repo] = cleaned.split('/')
    if (!owner || !repo) return
    localStorage.setItem('gh_token', token.trim())
    onConnect({ token: token.trim(), owner, repo })
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
        <form onSubmit={handleSubmit}>
          <label>
            Repository
            <input
              type="text"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label>
            Personal access token <span className="muted">(optional for public repos)</span>
            <input
              type="password"
              placeholder="ghp_… or github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="hint">
            Without a token GitHub allows 60 API requests/hour; with one you get 5,000. The token is
            stored only in your browser's localStorage and sent only to api.github.com.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <button type="submit" className="btn primary" disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect repository'}
          </button>
        </form>
      </div>
    </div>
  )
}
