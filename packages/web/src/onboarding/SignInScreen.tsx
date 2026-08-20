import { useState } from 'react'

interface Props {
  /** 'reconnect' is shown when the Supabase session is alive but the GitHub
   * provider token is missing or expired */
  mode: 'signin' | 'reconnect'
  onSignIn: () => Promise<void>
  onSignOut?: () => void
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function SignInScreen({ mode, onSignIn, onSignOut }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    try {
      await onSignIn()
      // Browser redirects to GitHub; busy state persists until navigation.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="connect-wrap">
      <div className="connect-card">
        <div className="connect-logo">⬢</div>
        <h1>Commit Sentinel</h1>
        {mode === 'signin' ? (
          <p className="connect-sub">
            Watch commits land on the branches you choose, check every change against your
            compliance baseline — OWASP Top 10 or MISRA C:2012 — and get an AI review of each one.
          </p>
        ) : (
          <p className="connect-sub">
            Your GitHub connection has expired. Sign in again to refresh access to your
            repositories — your monitored repos and analysis history are saved.
          </p>
        )}

        {error && <div className="error-banner">{error}</div>}

        <button
          type="button"
          className="btn primary signin-btn"
          onClick={() => void handleSignIn()}
          disabled={busy}
        >
          <GitHubMark />
          {busy
            ? 'Redirecting to GitHub…'
            : mode === 'signin'
              ? 'Sign in with GitHub'
              : 'Reconnect GitHub'}
        </button>

        {mode === 'reconnect' && onSignOut && (
          <button type="button" className="btn subtle" onClick={onSignOut}>
            Sign out
          </button>
        )}

        <p className="hint">
          Signing in grants read access to your repositories so commits can be fetched and
          analyzed. Analysis results are stored in your account.
        </p>
      </div>
    </div>
  )
}
