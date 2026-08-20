import { useCallback, useRef, useState } from 'react'
import { requestAiReview } from '../backend'
import { saveAiReviews } from '../db'
import { supabase } from '../supabase'
import type { AiReview, AnalyzedCommit } from '@fydo/core'
import type { RepoInfo } from '@fydo/core'

export interface AiReviewsState {
  reviews: Record<string, AiReview>
  running: Record<string, boolean>
  errors: Record<string, string>
  run: (commit: AnalyzedCommit) => void
  /** Replace state with persisted reviews (returning users / post-onboarding) */
  hydrate: (reviews: Record<string, AiReview>) => void
}

/** AI reviews run through the backend (server-side Anthropic key) and are
 * persisted to Supabase per repo. */
export function useAiReviews(
  repo: RepoInfo | null,
  repoId: string | null,
  /** Compliance framework id; selects the server-side review prompt */
  framework: string,
): AiReviewsState {
  const [reviews, setReviews] = useState<Record<string, AiReview>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const repoIdRef = useRef(repoId)
  repoIdRef.current = repoId

  /** Sole reset point: every path into a project (open, post-onboarding) and
   * out of one (new-project wizard) hydrates with the appropriate map. A
   * repo-change effect here would wipe reviews that were hydrated in the same
   * render batch as the repo switch. */
  const hydrate = useCallback((loaded: Record<string, AiReview>) => {
    setReviews(loaded)
    setRunning({})
    setErrors({})
  }, [])

  const run = useCallback(
    (commit: AnalyzedCommit) => {
      if (!repo || !commit.report) return
      const sha = commit.sha
      setRunning((prev) => ({ ...prev, [sha]: true }))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[sha]
        return next
      })

      void (async () => {
        try {
          const { data } = await supabase.auth.getSession()
          const accessToken = data.session?.access_token
          if (!accessToken) throw new Error('Not signed in.')

          const { review } = await requestAiReview(repo.provider, repo.fullName, accessToken, {
            commit: { message: commit.message, branch: commit.branch },
            report: commit.report!,
            framework,
          })
          setReviews((prev) => ({ ...prev, [sha]: review }))

          const id = repoIdRef.current
          if (id) {
            await saveAiReviews(id, { [sha]: review }).catch(() => {
              /* review still shown for this session */
            })
          }
        } catch (e) {
          setErrors((prev) => ({
            ...prev,
            [sha]: e instanceof Error ? e.message : String(e),
          }))
        } finally {
          setRunning((prev) => {
            const next = { ...prev }
            delete next[sha]
            return next
          })
        }
      })()
    },
    [repo, framework],
  )

  return { reviews, running, errors, run, hydrate }
}
