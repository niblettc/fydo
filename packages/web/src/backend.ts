/** Client for the @fydo/server graph backend. All calls degrade gracefully:
 * callers should treat failures as "no graph available". */

const BASE_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8787'

export interface IngestJob {
  state: 'running' | 'done' | 'error'
  headSha: string | null
  filesTotal: number
  filesParsed: number
  startedAt: string
  finishedAt: string | null
  error: string | null
  truncatedTree: boolean
}

export interface GraphStats {
  files: number
  imports: number
  symbols: number
  commits: number
  findings: number
}

export interface GraphStatus {
  job: IngestJob | null
  ingestedSha: string | null
  stats: GraphStats
}

export interface ImpactResponse {
  promptContext: string
  dependents: Array<{ changed: string; dependents: Array<{ path: string; distance: number }> }>
  componentsAffected: string[]
  downstreamComponents: string[]
}

export interface CommitRecord {
  sha: string
  branch: string
  message: string
  author: string
  date: string
  status: string
  files: Array<{ path: string; status: string; additions: number; deletions: number }>
  findings: Array<{
    ruleId: string
    owaspId: string
    severity: string
    title: string
    file: string
    line: number
    snippet: string
  }>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) {
    let message = `Backend error (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON body */
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export function fetchGraphStatus(owner: string, repo: string): Promise<GraphStatus> {
  return api<GraphStatus>(`/api/repos/${owner}/${repo}/status`)
}

export function startGraphIngest(
  owner: string,
  repo: string,
  token: string,
): Promise<{ job: IngestJob }> {
  return api<{ job: IngestJob }>(`/api/repos/${owner}/${repo}/ingest`, {
    method: 'POST',
    headers: token ? { 'X-GitHub-Token': token } : {},
  })
}

export function recordCommitToGraph(
  owner: string,
  repo: string,
  token: string,
  payload: CommitRecord,
): Promise<{ recorded: boolean }> {
  return api<{ recorded: boolean }>(`/api/repos/${owner}/${repo}/commits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'X-GitHub-Token': token } : {}),
    },
    body: JSON.stringify(payload),
  })
}

export function fetchImpact(
  owner: string,
  repo: string,
  paths: string[],
): Promise<ImpactResponse> {
  return api<ImpactResponse>(`/api/repos/${owner}/${repo}/impact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}
