/** Client for the @fydo/server backend (dependency graph + AI reviews). */

import type { AiReview, AnalysisReport, GitProvider } from '@fydo/core'

const BASE_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8787'

/** Route prefix; the project path is one encoded segment because GitLab
 * namespaces can be nested (group/subgroup/project). */
function repoPath(provider: GitProvider, fullName: string): string {
  return `/api/repos/${provider}/${encodeURIComponent(fullName)}`
}

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

export interface ImpactGraphNode {
  path: string
  changed: boolean
  /** Import hops from the nearest changed file (0 = changed) */
  distance: number
  component: string | null
  /** Worst severity among prior findings affecting this file, if any */
  severity: string | null
}

export interface ImpactGraph {
  nodes: ImpactGraphNode[]
  edges: Array<{ source: string; target: string }>
  truncated: boolean
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

export function fetchGraphStatus(provider: GitProvider, fullName: string): Promise<GraphStatus> {
  return api<GraphStatus>(`${repoPath(provider, fullName)}/status`)
}

export function startGraphIngest(
  provider: GitProvider,
  fullName: string,
  token: string,
): Promise<{ job: IngestJob }> {
  return api<{ job: IngestJob }>(`${repoPath(provider, fullName)}/ingest`, {
    method: 'POST',
    headers: token ? { 'X-Git-Token': token } : {},
  })
}

export function recordCommitToGraph(
  provider: GitProvider,
  fullName: string,
  token: string,
  payload: CommitRecord,
): Promise<{ recorded: boolean }> {
  return api<{ recorded: boolean }>(`${repoPath(provider, fullName)}/commits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'X-Git-Token': token } : {}),
    },
    body: JSON.stringify(payload),
  })
}

export function requestAiReview(
  provider: GitProvider,
  fullName: string,
  supabaseAccessToken: string,
  payload: { commit: { message: string; branch: string }; report: AnalysisReport },
): Promise<{ review: AiReview }> {
  return api<{ review: AiReview }>(`${repoPath(provider, fullName)}/reviews`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${supabaseAccessToken}`,
    },
    body: JSON.stringify(payload),
  })
}

export function fetchImpact(
  provider: GitProvider,
  fullName: string,
  paths: string[],
): Promise<ImpactResponse> {
  return api<ImpactResponse>(`${repoPath(provider, fullName)}/impact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}

export function fetchImpactGraph(
  provider: GitProvider,
  fullName: string,
  paths: string[],
): Promise<ImpactGraph> {
  return api<ImpactGraph>(`${repoPath(provider, fullName)}/impact-graph`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
}
