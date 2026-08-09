import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase'

/**
 * Supabase persists its own session but drops the GitHub provider token on
 * refresh, so we keep our own copy. When GitHub starts rejecting it, the app
 * prompts a re-sign-in to mint a fresh one.
 */
const PROVIDER_TOKEN_KEY = 'gh_provider_token'

export interface AuthState {
  session: Session | null
  /** True until the initial session restore completes */
  loading: boolean
  /** GitHub access token from the OAuth sign-in, if we still have one */
  githubToken: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [githubToken, setGithubToken] = useState<string | null>(
    () => localStorage.getItem(PROVIDER_TOKEN_KEY),
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
    setGithubToken(null)
    await supabase.auth.signOut()
  }, [])

  return { session, loading, githubToken, signIn, signOut }
}
