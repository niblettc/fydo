import type { BranchInfo, RateLimitInfo, RepoInfo } from './types'

const API = 'https://api.github.com'

export interface CommitListItem {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string } | null
  }
  author: { login: string; avatar_url: string } | null
  html_url: string
}

export interface CommitDetail extends CommitListItem {
  stats: { additions: number; deletions: number; total: number }
  files: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
    patch?: string
  }>
}

export interface RepoListItem {
  fullName: string
  owner: string
  repo: string
  private: boolean
  description: string | null
  pushedAt: string
}

/** Error from any git provider API; the name predates GitLab support. */
export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

/** The provider-agnostic surface the app uses to talk to a git host.
 * Return shapes follow GitHub's API; other providers adapt to them. */
export interface GitClient {
  onRateLimit?: (info: RateLimitInfo) => void
  getToken(): string
  getRepo(owner: string, repo: string): Promise<RepoInfo>
  getBranches(owner: string, repo: string): Promise<BranchInfo[]>
  /** `path` limits results to commits touching that directory */
  getCommits(
    owner: string,
    repo: string,
    branch: string,
    perPage?: number,
    path?: string,
  ): Promise<CommitListItem[]>
  getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail>
  getTree(owner: string, repo: string, ref: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>
  getBlob(owner: string, repo: string, sha: string): Promise<string>
}

/** Splits a full path at the last slash, so nested GitLab namespaces
 * (group/subgroup/project) survive the owner/repo calling convention. */
export function splitFullName(fullName: string): [string, string] {
  const i = fullName.lastIndexOf('/')
  return [fullName.slice(0, i), fullName.slice(i + 1)]
}

export class GitHubClient implements GitClient {
  private token: string
  onRateLimit?: (info: RateLimitInfo) => void

  constructor(token: string) {
    this.token = token.trim()
  }

  getToken(): string {
    return this.token
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const res = await fetch(`${API}${path}`, { headers })

    const remaining = res.headers.get('x-ratelimit-remaining')
    const limit = res.headers.get('x-ratelimit-limit')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining && limit && reset && this.onRateLimit) {
      this.onRateLimit({
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: new Date(Number(reset) * 1000),
      })
    }

    if (!res.ok) {
      let message = `GitHub API error (${res.status})`
      try {
        const body = (await res.json()) as { message?: string }
        if (body?.message) message = body.message
      } catch {
        /* non-JSON body */
      }
      if (res.status === 403 && remaining === '0') {
        message = 'GitHub API rate limit exceeded. Add a personal access token to raise the limit.'
      }
      throw new GitHubError(res.status, message)
    }
    return res.json() as Promise<T>
  }

  async getUser(): Promise<{ login: string; avatarUrl: string }> {
    const data = await this.request<{ login: string; avatar_url: string }>('/user')
    return { login: data.login, avatarUrl: data.avatar_url }
  }

  async getUserRepos(): Promise<RepoListItem[]> {
    const repos: RepoListItem[] = []
    for (let page = 1; page <= 5; page++) {
      const data = await this.request<
        Array<{
          full_name: string
          owner: { login: string }
          name: string
          private: boolean
          description: string | null
          pushed_at: string
        }>
      >(
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      )
      repos.push(
        ...data.map((r) => ({
          fullName: r.full_name,
          owner: r.owner.login,
          repo: r.name,
          private: r.private,
          description: r.description,
          pushedAt: r.pushed_at,
        })),
      )
      if (data.length < 100) break
    }
    return repos
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const data = await this.request<{
      full_name: string
      description: string | null
      default_branch: string
      private: boolean
      html_url: string
    }>(`/repos/${owner}/${repo}`)
    return {
      provider: 'github',
      owner,
      repo,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      private: data.private,
      htmlUrl: data.html_url,
    }
  }

  async getBranches(owner: string, repo: string): Promise<BranchInfo[]> {
    const branches: BranchInfo[] = []
    for (let page = 1; page <= 3; page++) {
      const data = await this.request<
        Array<{ name: string; commit: { sha: string }; protected: boolean }>
      >(`/repos/${owner}/${repo}/branches?per_page=100&page=${page}`)
      branches.push(
        ...data.map((b) => ({ name: b.name, headSha: b.commit.sha, protected: b.protected })),
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
    return this.request<CommitListItem[]>(
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}${pathParam}`,
    )
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
    return this.request<CommitDetail>(`/repos/${owner}/${repo}/commits/${sha}`)
  }

  /** Full recursive file tree at a ref. `truncated` is set by GitHub for very large repos. */
  async getTree(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const data = await this.request<{
      tree: Array<{ path: string; type: string; sha: string; size?: number }>
      truncated: boolean
    }>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
    return {
      entries: data.tree
        .filter((e) => e.type === 'blob' || e.type === 'tree')
        .map((e) => ({
          path: e.path,
          type: e.type as 'blob' | 'tree',
          sha: e.sha,
          size: e.size,
        })),
      truncated: data.truncated,
    }
  }

  /** Fetch a file's content by blob sha (avoids path-encoding issues). */
  async getBlob(owner: string, repo: string, sha: string): Promise<string> {
    const data = await this.request<{ content: string; encoding: string }>(
      `/repos/${owner}/${repo}/git/blobs/${sha}`,
    )
    if (data.encoding === 'base64') {
      // atob works in both browsers and Node 16+
      const binary = atob(data.content.replace(/\n/g, ''))
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    }
    return data.content
  }
}
