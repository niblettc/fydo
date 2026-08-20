import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase'

/**
 * Supabase persists its own session but drops the GitHub provider token on
 * refresh, so we keep our own copy. When GitHub starts rejecting it, the app
 * prompts a re-sign-in to mint a fresh one.
 *
 * GitLab uses a personal access token the user pastes in (read_api scope),
 * stored the same way. It is independent of the Supabase session sign-in.
 */
const PROVIDER_TOKEN_KEY = 'gh_provider_token'
const GITLAB_TOKEN_KEY = 'gl_provider_token'

export interface AuthState {
  session: Session | null
  /** True until the initial session restore completes */
  loading: boolean
  /** GitHub access token from the OAuth sign-in, if we still have one */
  githubToken: string | null
  /** GitLab personal access token, if the user connected GitLab */
  gitlabToken: string | null
  /** Store (or clear, with null) the GitLab personal access token */
  setGitlabToken: (token: string | null) => void
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [githubToken, setGithubToken] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_TOKEN_KEY),
  )
  const [gitlabToken, setGitlabTokenState] = useState<string | null>(
    () => localStorage.getItem(GITLAB_TOKEN_KEY),
  )

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.provider_token) {
        localStorage.setItem(PROVIDER_TOKEN_KEY, s.provider_token)
        setGithubToken(s.provider_token)
      }
      if (!s) {
        localStorage.removeItem(PROVIDER_TOKEN_KEY)
        setGithubToken(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const setGitlabToken = useCallback((token: string | null) => {
    if (token) {
      localStorage.setItem(GITLAB_TOKEN_KEY, token)
    } else {
      localStorage.removeItem(GITLAB_TOKEN_KEY)
    }
    setGitlabTokenState(token)
  }, [])

  const signIn = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        scopes: 'repo read:user',
        redirectTo: window.location.origin,
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem(PROVIDER_TOKEN_KEY)
    localStorage.removeItem(GITLAB_TOKEN_KEY)
    setGithubToken(null)
    setGitlabTokenState(null)
    await supabase.auth.signOut()
  }, [])

  return { session, loading, githubToken, gitlabToken, setGitlabToken, signIn, signOut }
}
