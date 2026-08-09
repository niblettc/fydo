import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGraphStatus, startGraphIngest } from '../backend'
import type { GraphStatus } from '../backend'

interface Props {
  owner: string
  repo: string
  token: string
}

export function GraphPanel({ owner, repo, token }: Props) {
  const [status, setStatus] = useState<GraphStatus | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await fetchGraphStatus(owner, repo)
      setStatus(s)
      setBackendDown(false)
      return s
    } catch {
      setBackendDown(true)
      return null
    }
  }, [owner, repo])

  // Poll every 2s while an ingestion is running, otherwise fetch once
  useEffect(() => {
    void refresh()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [refresh])

  useEffect(() => {
    if (status?.job?.state === 'running' && pollRef.current === null) {
      pollRef.current = window.setInterval(() => void refresh(), 2000)
    }
    if (status?.job?.state !== 'running' && pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [status?.job?.state, refresh])

  async function build() {
    setStarting(true)
    try {
      await startGraphIngest(owner, repo, token)
      await refresh()
    } catch {
      setBackendDown(true)
    } finally {
      setStarting(false)
    }
  }

  const job = status?.job
  const stats = status?.stats
  const hasGraph = (stats?.files ?? 0) > 0

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Dependency graph</h2>
        {hasGraph && <span className="badge pass">ready</span>}
      </div>

      {backendDown && (
        <p className="muted small-text">
          Graph backend not reachable. Start it with <code>npm run dev:server</code> (and Neo4j
          via <code>docker compose up -d</code>) to restore dependency-impact context in AI
          reviews.
        </p>
      )}

      {!backendDown && (
        <>
          {job?.state === 'running' && (
            <p className="muted small-text">
              Rebuilding… {job.filesParsed}/{job.filesTotal} files parsed
            </p>
          )}
          {job?.state === 'error' && <div className="error-banner">{job.error}</div>}

          {stats && hasGraph && (
            <ul className="graph-stats">
              <li>
                <strong>{stats.files}</strong> files
              </li>
              <li>
                <strong>{stats.imports}</strong> import edges
              </li>
              <li>
                <strong>{stats.symbols}</strong> symbols
              </li>
              <li>
                <strong>{stats.commits}</strong> commits
              </li>
              <li>
                <strong>{stats.findings}</strong> findings
              </li>
            </ul>
          )}

          <p className="muted small-text">
            Built during setup; it keeps itself current as commits land. Rebuild if the codebase
            changed drastically outside monitored branches.
          </p>

          <button
            className="btn"
            onClick={() => void build()}
            disabled={starting || job?.state === 'running'}
          >
            {job?.state === 'running' ? 'Rebuilding…' : 'Rebuild graph'}
          </button>
        </>
      )}
    </section>
  )
}
