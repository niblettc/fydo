import { useCallback, useEffect, useState } from 'react'
import { reviewCommit } from '../ai'
import type { AiReview, AnalyzedCommit } from '../types'

const KEY_STORAGE = 'anthropic_key'

function reviewsStorageKey(repoFullName: string) {
  return `ai_reviews:${repoFullName}`
}

function loadStoredReviews(repoFullName: string): Record<string, AiReview> {
  try {
    const raw = localStorage.getItem(reviewsStorageKey(repoFullName))
    return raw ? (JSON.parse(raw) as Record<string, AiReview>) : {}
  } catch {
    return {}
  }
}

export interface AiReviewsState {
  hasKey: boolean
  saveKey: (key: string) => void
  reviews: Record<string, AiReview>
  running: Record<string, boolean>
  errors: Record<string, string>
  run: (commit: AnalyzedCommit) => void
}

export function useAiReviews(repoFullName: string | null): AiReviewsState {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '')
  const [reviews, setReviews] = useState<Record<string, AiReview>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setReviews(repoFullName ? loadStoredReviews(repoFullName) : {})
    setRunning({})
    setErrors({})
  }, [repoFullName])

  const saveKey = useCallback((key: string) => {
    const trimmed = key.trim()
    localStorage.setItem(KEY_STORAGE, trimmed)
    setApiKey(trimmed)
  }, [])

  const run = useCallback(
    (commit: AnalyzedCommit) => {
      if (!repoFullName || !apiKey || !commit.report) return
      const sha = commit.sha
      setRunning((prev) => ({ ...prev, [sha]: true }))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[sha]
        return next
      })
      void reviewCommit(apiKey, commit, commit.report)
        .then((review) => {
          setReviews((prev) => {
            const next = { ...prev, [sha]: review }
            try {
              localStorage.setItem(reviewsStorageKey(repoFullName), JSON.stringify(next))
            } catch {
              /* storage full — review still shown for this session */
            }
            return next
          })
        })
        .catch((e: unknown) => {
          setErrors((prev) => ({
            ...prev,
            [sha]: e instanceof Error ? e.message : String(e),
          }))
        })
        .finally(() => {
          setRunning((prev) => {
            const next = { ...prev }
            delete next[sha]
            return next
          })
        })
    },
    [repoFullName, apiKey],
  )

  return { hasKey: apiKey.length > 0, saveKey, reviews, running, errors, run }
}
