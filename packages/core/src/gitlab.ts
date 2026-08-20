/** GitLab (gitlab.com) client for public projects, adapting GitLab's API v4
 * to the GitHub-shaped GitClient interface the rest of the app consumes.
 * A token is optional: public-project endpoints work unauthenticated. */

import { GitHubClient, GitHubError } from './github'
import type { CommitDetail, CommitListItem, GitClient, RepoListItem, TreeEntry } from './github'
import type { BranchInfo, GitProvider, RateLimitInfo, RepoInfo } from './types'

const API = 'https://gitlab.com/api/v4'

const projectId = (owner: string, repo: string) => encodeURIComponent(`${owner}/${repo}`)

interface GitLabDiffEntry {
  old_path: string
  new_path: string
  diff: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
}

function diffStatus(d: GitLabDiffEntry): string {
  if (d.new_file) return 'added'
  if (d.deleted_file) return 'removed'
  if (d.renamed_file) return 'renamed'
  return 'modified'
}

/** GitLab's diff API has no per-file addition/deletion counts, so derive
 * them from the unified diff text. */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Unauthenticated gitlab.com throttles hard (raw blobs at ~300 req/min),
 * so bulk operations like graph ingest routinely hit 429s mid-run. */
const MAX_RATE_LIMIT_RETRIES = 5

export class GitLabClient implements GitClient {
  private token: string
  onRateLimit?: (info: RateLimitInfo) => void

  constructor(token = '') {
    this.token = token.trim()
  }

  getToken(): string {
    return this.token
  }

  private headers(): Record<string, string> {
    return this.token ? { 'PRIVATE-TOKEN': this.token } : {}
  }

  private async fetchRaw(path: string, attempt = 0): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${API}${path}`, { headers: this.headers() })
    } catch (e) {
      // Throttled connections drop mid-flight fairly often; retry briefly.
      if (attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(2000)
        return this.fetchRaw(path, attempt + 1)
      }
      throw e
    }

    const remaining = res.headers.get('ratelimit-remaining')
    const limit = res.headers.get('ratelimit-limit')
    const reset = res.headers.get('ratelimit-reset')
    if (remaining && limit && reset && this.onRateLimit) {
      this.onRateLimit({
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: new Date(Number(reset) * 1000),
      })
    }

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60000) : 30000
      await sleep(waitMs)
      return this.fetchRaw(path, attempt + 1)
    }

    if (!res.ok) {
      let message = `GitLab API error (${res.status})`
      try {
        const body = (await res.json()) as { message?: string; error?: string }
        const detail = body?.message ?? body?.error
        if (detail) message = typeof detail === 'string' ? detail : JSON.stringify(detail)
      } catch {
        /* non-JSON body */
      }
      if (res.status === 429) {
        message = 'GitLab API rate limit exceeded. Wait a moment and retry.'
      }
      throw new GitHubError(res.status, message)
    }
    return res
  }

  private async request<T>(path: string): Promise<T> {
    const res = await this.fetchRaw(path)
    return res.json() as Promise<T>
  }

  /** Validates the token; used before storing a pasted personal access token. */
  async getUser(): Promise<{ login: string; avatarUrl: string }> {
    const data = await this.request<{ username: string; avatar_url: string }>('/user')
    return { login: data.username, avatarUrl: data.avatar_url }
  }

  /** Projects the token holder is a member of (private ones included),
   * most recently active first. Requires a token with the read_api scope. */
  async getUserProjects(): Promise<RepoListItem[]> {
    const projects: RepoListItem[] = []
    for (let page = 1; page <= 3; page++) {
      const data = await this.request<
        Array<{
          path_with_namespace: string
          path: string
          namespace: { full_path: string }
          visibility?: string
          description: string | null
          last_activity_at: string
        }>
      >(
        `/projects?membership=true&archived=false&order_by=last_activity_at&sort=desc&per_page=100&page=${page}`,
      )
      projects.push(
        ...data.map((p) => ({
          fullName: p.path_with_namespace,
          owner: p.namespace.full_path,
          repo: p.path,
          private: p.visibility !== undefined && p.visibility !== 'public',
          description: p.description,
          pushedAt: p.last_activity_at,
        })),
      )
      if (data.length < 100) break
    }
    return projects
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const data = await this.request<{
      path_with_namespace: string
      description: string | null
      default_branch: string
      visibility?: string
      web_url: string
    }>(`/projects/${projectId(owner, repo)}`)
    return {
      provider: 'gitlab',
      owner,
      repo,
      fullName: data.path_with_namespace,
      description: data.description,
      defaultBranch: data.default_branch,
      private: data.visibility !== undefined && data.visibility !== 'public',
      htmlUrl: data.web_url,
    }
  }

  async getBranches(owner: string, repo: string): Promise<BranchInfo[]> {
    const branches: BranchInfo[] = []
    for (let page = 1; page <= 3; page++) {
      const data = await this.request<
        Array<{ name: string; commit: { id: string }; protected: boolean }>
      >(`/projects/${projectId(owner, repo)}/repository/branches?per_page=100&page=${page}`)
      branches.push(
        ...data.map((b) => ({ name: b.name, headSha: b.commit.id, protected: b.protected })),
      )
      if (data.length < 100) break
    }
    return branches
  }

  async getCommits(
    owner: string,
    repo: string,
    branch: string,
    perPage = 10,
    path?: string,
  ): Promise<CommitListItem[]> {
    const pathParam = path ? `&path=${encodeURIComponent(path)}` : ''
    const data = await this.request<
      Array<{
        id: string
        message: string
        author_name: string
        committed_date: string
        web_url: string
      }>
    >(
      `/projects/${projectId(owner, repo)}/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=${perPage}${pathParam}`,
    )
    return data.map((c) => ({
      sha: c.id,
      commit: {
        message: c.message,
        author: { name: c.author_name, date: c.committed_date },
      },
      author: null,
      html_url: c.web_url,
    }))
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
    const id = projectId(owner, repo)
    const [commit, diffs] = await Promise.all([
      this.request<{
        id: string
        message: string
        author_name: string
        committed_date: string
        web_url: string
        stats?: { additions: number; deletions: number; total: number }
      }>(`/projects/${id}/repository/commits/${sha}`),
      this.request<GitLabDiffEntry[]>(
        `/projects/${id}/repository/commits/${sha}/diff?per_page=100`,
      ),
    ])

    return {
      sha: commit.id,
      commit: {
        message: commit.message,
        author: { name: commit.author_name, date: commit.committed_date },
      },
      author: null,
      html_url: commit.web_url,
      stats: commit.stats ?? { additions: 0, deletions: 0, total: 0 },
      files: diffs.map((d) => ({
        filename: d.new_path,
        status: diffStatus(d),
        ...countDiffLines(d.diff),
        patch: d.diff || undefined,
      })),
    }
  }

  async getTree(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const id = projectId(owner, repo)
    const entries: TreeEntry[] = []
    const maxPages = 50
    let truncated = false
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.fetchRaw(
        `/projects/${id}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`,
      )
      const data = (await res.json()) as Array<{ id: string; type: string; path: string }>
      entries.push(
        ...data
          .filter((e) => e.type === 'blob' || e.type === 'tree')
          .map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', sha: e.id })),
      )
      const nextPage = res.headers.get('x-next-page')
      if (!nextPage) break
      if (page === maxPages) truncated = true
    }
    return { entries, truncated }
  }

  async getBlob(owner: string, repo: string, sha: string): Promise<string> {
    const res = await this.fetchRaw(
      `/projects/${projectId(owner, repo)}/repository/blobs/${sha}/raw`,
    )
    return res.text()
  }
}

/** Token semantics per provider: GitHub requires one, GitLab is optional
 * (public projects only). */
export function createGitClient(provider: GitProvider, token: string): GitClient {
  return provider === 'gitlab' ? new GitLabClient(token) : new GitHubClient(token)
}
