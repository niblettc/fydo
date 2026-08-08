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

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class GitHubClient {
  private token: string
  onRateLimit?: (info: RateLimitInfo) => void

  constructor(token: string) {
    this.token = token.trim()
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
        const body = await res.json()
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
  ): Promise<CommitListItem[]> {
    return this.request<CommitListItem[]>(
      `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
    )
  }

  async getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
    return this.request<CommitDetail>(`/repos/${owner}/${repo}/commits/${sha}`)
  }
}
