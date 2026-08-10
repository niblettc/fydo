import { useCallback, useEffect, useRef, useState } from 'react'
import type { FindingOverride } from '@fydo/core'
import { loadFindingOverrides, upsertFindingOverride } from '../db'

export interface FindingOverridesState {
  overrides: Record<string, FindingOverride>
  /** Manually triage a finding; optimistic, persisted to Supabase */
  setStatus: (sha: string, findingId: string, status: FindingOverride['status'], note?: string) => void
}

export function useFindingOverrides(repoId: string | null): FindingOverridesState {
  const [overrides, setOverrides] = useState<Record<string, FindingOverride>>({})
  const repoIdRef = useRef(repoId)
  repoIdRef.current = repoId

  useEffect(() => {
    setOverrides({})
    if (!repoId) return
    let cancelled = false
    void loadFindingOverrides(repoId)
      .then((map) => {
        if (!cancelled) setOverrides(map)
      })
      .catch(() => {
        /* triage history unavailable this session; detector statuses still shown */
      })
    return () => {
      cancelled = true
    }
  }, [repoId])

  const setStatus = useCallback(
    (sha: string, findingId: string, status: FindingOverride['status'], note?: string) => {
      setOverrides((prev) => ({ ...prev, [findingId]: { status, note } }))
      const id = repoIdRef.current
      if (id) {
        void upsertFindingOverride(id, sha, findingId, status, note).catch(() => {
          /* optimistic state stays for this session */
        })
      }
    },
    [],
  )

  return { overrides, setStatus }
}
