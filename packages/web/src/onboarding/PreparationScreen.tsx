import { useEffect, useRef } from 'react'
import { STAGE_LABELS, STAGE_ORDER, usePreparation } from '../hooks/usePreparation'
import type { PreparationResult, StageState } from '../hooks/usePreparation'
import type { GitClient, RepoInfo } from '@fydo/core'

interface Props {
  client: GitClient
  repo: RepoInfo
  selectedBranches: string[]
  framework: string
  onComplete: (result: PreparationResult) => void
  onBack: () => void
}

function StageIcon({ state }: { state: StageState }) {
  if (state.status === 'done') return <span className="stage-icon done">✓</span>
  if (state.status === 'failed') return <span className="stage-icon failed">✗</span>
  if (state.status === 'running') return <span className="stage-icon running" />
  return <span className="stage-icon pending" />
}

function progressText(state: StageState): string | null {
  if (!state.progress) return null
  return `${state.progress.done} / ${state.progress.total}`
}

export function PreparationScreen({
  client,
  repo,
  selectedBranches,
  framework,
  onComplete,
  onBack,
}: Props) {
  const prep = usePreparation(client, repo, selectedBranches, framework)
  const startedRef = useRef(false)
  const completedRef = useRef(false)

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      prep.start()
    }
  }, [prep])

  useEffect(() => {
    if (prep.status === 'done' && prep.result && !completedRef.current) {
      completedRef.current = true
      onComplete(prep.result)
    }
  }, [prep.status, prep.result, onComplete])

  return (
    <>
      <ul className="stage-list">
        {STAGE_ORDER.map((id) => {
          const state = prep.stages[id]
          const progress = progressText(state)
          return (
            <li key={id} className={`stage-row ${state.status}`}>
              <StageIcon state={state} />
              <div className="stage-main">
                <div className="stage-label">
                  {STAGE_LABELS[id]}
                  {progress && <span className="muted small-text"> — {progress}</span>}
                </div>
                {state.status === 'running' && state.progress && (
                  <div className="stage-bar">
                    <div
                      className="stage-bar-fill"
                      style={{
                        width: `${Math.round((state.progress.done / Math.max(state.progress.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {state.status === 'failed' && state.error && (
                  <div className="error-banner">{state.error}</div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {prep.status === 'failed' && (
        <div className="wizard-actions">
          <button type="button" className="btn subtle" onClick={onBack}>
            Back to branches
          </button>
          <button type="button" className="btn primary" onClick={prep.retry}>
            Retry
          </button>
        </div>
      )}

      {prep.status === 'running' && (
        <p className="hint">
          Setup runs once per repository — after this, new commits are analyzed automatically as
          they land.
        </p>
      )}
    </>
  )
}
