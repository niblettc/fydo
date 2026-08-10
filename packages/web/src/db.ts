/** Supabase persistence for repo setup, commit analyses, and AI reviews.
 * The dependency graph itself lives in Neo4j behind @fydo/server; Supabase
 * stores everything account-scoped so returning users skip onboarding. */

import { supabase } from './supabase'
import type {
  AiReview,
  AnalysisReport,
  AnalyzedCommit,
  CommitStatus,
  Finding,
  FindingOverride,
} from '@fydo/core'

export const FRAMEWORK_OWASP = 'owasp-top-10-2021'

export interface RepoRow {
  id: string
  fullName: string
  defaultBranch: string
  selectedBranches: string[]
  framework: string
  graphIngestedSha: string | null
  onboardedAt: string | null
}

interface RepoRecord {
  id: string
  full_name: string
  default_branch: string
  selected_branches: string[]
  framework: string
  graph_ingested_sha: string | null
  onboarded_at: string | null
}

function mapRepo(r: RepoRecord): RepoRow {
  return {
    id: r.id,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    selectedBranches: r.selected_branches,
    framework: r.framework,
    graphIngestedSha: r.graph_ingested_sha,
    onboardedAt: r.onboarded_at,
  }
}

export async function fetchMyRepos(): Promise<RepoRow[]> {
  const { data, error } = await supabase
    .from('repos')
    .select('id, full_name, default_branch, selected_branches, framework, graph_ingested_sha, onboarded_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as RepoRecord[]).map(mapRepo)
}

export async function upsertRepo(opts: {
  fullName: string
  defaultBranch: string
  selectedBranches: string[]
  framework: string
  graphIngestedSha: string | null
  onboarded: boolean
}): Promise<RepoRow> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Not signed in.')

  const { data, error } = await supabase
    .from('repos')
    .upsert(
      {
        user_id: userData.user.id,
        full_name: opts.fullName,
        default_branch: opts.defaultBranch,
        selected_branches: opts.selectedBranches,
        framework: opts.framework,
        graph_ingested_sha: opts.graphIngestedSha,
        ...(opts.onboarded ? { onboarded_at: new Date().toISOString() } : {}),
      },
      { onConflict: 'user_id,full_name' },
    )
    .select('id, full_name, default_branch, selected_branches, framework, graph_ingested_sha, onboarded_at')
    .single()
  if (error) throw new Error(error.message)
  return mapRepo(data as RepoRecord)
}

export async function updateRepoBranches(repoId: string, selectedBranches: string[]): Promise<void> {
  const { error } = await supabase
    .from('repos')
    .update({ selected_branches: selectedBranches })
    .eq('id', repoId)
  if (error) throw new Error(error.message)
}

interface CommitRecord {
  sha: string
  branch: string
  status: string
  message: string
  author: string
  author_avatar: string | null
  committed_at: string | null
  url: string
  files_changed: number
  additions: number
  deletions: number
  findings: Finding[]
  report: AnalysisReport | null
}

export async function saveCommitAnalyses(repoId: string, commits: AnalyzedCommit[]): Promise<void> {
  const rows = commits
    .filter((c) => c.status !== 'analyzing' && c.status !== 'error')
    .map((c) => ({
      repo_id: repoId,
      sha: c.sha,
      branch: c.branch,
      status: c.status,
      message: c.message,
      author: c.author,
      author_avatar: c.authorAvatar ?? null,
      committed_at: c.date || null,
      url: c.url,
      files_changed: c.filesChanged,
      additions: c.additions,
      deletions: c.deletions,
      findings: c.findings,
      report: c.report ?? null,
    }))
  if (rows.length === 0) return
  const { error } = await supabase
    .from('commit_analyses')
    .upsert(rows, { onConflict: 'repo_id,branch,sha' })
  if (error) throw new Error(error.message)
}

export async function loadCommitAnalyses(repoId: string, limit = 100): Promise<AnalyzedCommit[]> {
  const { data, error } = await supabase
    .from('commit_analyses')
    .select(
      'sha, branch, status, message, author, author_avatar, committed_at, url, files_changed, additions, deletions, findings, report',
    )
    .eq('repo_id', repoId)
    .order('committed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data as CommitRecord[]).map((r) => ({
    sha: r.sha,
    branch: r.branch,
    status: r.status as CommitStatus,
    message: r.message,
    author: r.author,
    authorAvatar: r.author_avatar ?? undefined,
    date: r.committed_at ?? '',
    url: r.url,
    findings: r.findings ?? [],
    report: r.report ?? undefined,
    filesChanged: r.files_changed,
    additions: r.additions,
    deletions: r.deletions,
  }))
}

export async function saveAiReviews(
  repoId: string,
  reviews: Record<string, AiReview>,
): Promise<void> {
  const rows = Object.entries(reviews).map(([sha, review]) => ({
    repo_id: repoId,
    sha,
    review,
    model: review.model,
    reviewed_at: review.reviewedAt,
  }))
  if (rows.length === 0) return
  const { error } = await supabase.from('ai_reviews').upsert(rows, { onConflict: 'repo_id,sha' })
  if (error) throw new Error(error.message)
}

export async function loadFindingOverrides(
  repoId: string,
): Promise<Record<string, FindingOverride>> {
  const { data, error } = await supabase
    .from('finding_overrides')
    .select('finding_id, status, note')
    .eq('repo_id', repoId)
  if (error) throw new Error(error.message)
  const map: Record<string, FindingOverride> = {}
  for (const row of data as Array<{ finding_id: string; status: FindingOverride['status']; note: string | null }>) {
    map[row.finding_id] = { status: row.status, note: row.note ?? undefined }
  }
  return map
}

export async function upsertFindingOverride(
  repoId: string,
  sha: string,
  findingId: string,
  status: FindingOverride['status'],
  note?: string,
): Promise<void> {
  const { error } = await supabase.from('finding_overrides').upsert(
    {
      repo_id: repoId,
      sha,
      finding_id: findingId,
      status,
      note: note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'repo_id,finding_id' },
  )
  if (error) throw new Error(error.message)
}

export async function loadAiReviews(repoId: string): Promise<Record<string, AiReview>> {
  const { data, error } = await supabase
    .from('ai_reviews')
    .select('sha, review')
    .eq('repo_id', repoId)
  if (error) throw new Error(error.message)
  const map: Record<string, AiReview> = {}
  for (const row of data as Array<{ sha: string; review: AiReview }>) {
    map[row.sha] = row.review
  }
  return map
}
