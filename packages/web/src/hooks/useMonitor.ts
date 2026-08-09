import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeCommit, statusForFindings } from '@fydo/core'
import type { GitHubClient } from '@fydo/core'
import type { AnalyzedCommit, RepoInfo } from '@fydo/core'
import { recordCommitToGraph } from '../backend'

const INITIAL_COMMITS_PER_BRANCH = 5
const POLL_COMMITS_PER_BRANCH = 15

export interface MonitorState {
  commits: AnalyzedCommit[]
  lastPolledAt: Date | null
  polling: boolean
  error: string | null
  refresh: () => void
}

function commitKey(branch: string, sha: string) {
  return `${branch}:${sha}`
}

export function useMonitor(
  client: GitHubClient | null,
  repo: RepoInfo | null,
  branches: string[],
  pollIntervalSec: number,
): MonitorState {
  const [commits, setCommits] = useState<AnalyzedCommit[]>([])
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seenRef = useRef<Set<string>>(new Set())
  const busyRef = useRef(false)

  // Reset when the repo changes
  useEffect(() => {
    seenRef.current = new Set()
    setCommits([])
    setError(null)
  }, [repo?.fullName])

  const poll = useCallback(
    async (isInitialForBranch: (b: string) => boolean) => {
      if (!client || !repo || branches.length === 0 || busyRef.current) return
      busyRef.current = true
      setPolling(true)
      setError(null)
      try {
        for (const branch of branches) {
          const perPage = isInitialForBranch(branch)
            ? INITIAL_COMMITS_PER_BRANCH
            : POLL_COMMITS_PER_BRANCH
          const list = await client.getCommits(repo.owner, repo.repo, branch, perPage)
          const fresh = list.filter((c) => !seenRef.current.has(commitKey(branch, c.sha)))

          for (const item of fresh) {
            const key = commitKey(branch, item.sha)
            seenRef.current.add(key)
            const placeholder: AnalyzedCommit = {
              sha: item.sha,
              branch,
              message: item.commit.message.split('\n')[0],
              author: item.author?.login ?? item.commit.author?.name ?? 'unknown',
              authorAvatar: item.author?.avatar_url,
              date: item.commit.author?.date ?? '',
              url: item.html_url,
              status: 'analyzing',
              findings: [],
              filesChanged: 0,
              additions: 0,
              deletions: 0,
            }
            setCommits((prev) => [placeholder, ...prev])

            try {
              const detail = await client.getCommit(repo.owner, repo.repo, item.sha)
              const report = analyzeCommit(detail)

              // Feed the dependency graph backend; monitoring works fine without it.
              void recordCommitToGraph(repo.owner, repo.repo, client.getToken(), {
                sha: item.sha,
                branch,
                message: placeholder.message,
                author: placeholder.author,
                date: placeholder.date,
                status: statusForFindings(report.findings),
                files: (detail.files ?? []).map((f) => ({
                  path: f.filename,
                  status: f.status,
                  additions: f.additions,
                  deletions: f.deletions,
                })),
                findings: report.findings.map((f) => ({
                  ruleId: f.ruleId,
                  owaspId: f.owaspId,
                  severity: f.severity,
                  title: f.title,
                  file: f.file,
                  line: f.line,
                  snippet: f.snippet,
                })),
              }).catch(() => {
                /* backend offline — graph features simply unavailable */
              })

              setCommits((prev) =>
                prev.map((c) =>
                  c.sha === item.sha && c.branch === branch
                    ? {
                        ...c,
                        status: statusForFindings(report.findings),
                        findings: report.findings,
                        report,
                        filesChanged: detail.files?.length ?? 0,
                        additions: detail.stats?.additions ?? 0,
                        deletions: detail.stats?.deletions ?? 0,
                      }
                    : c,
                ),
              )
            } catch (e) {
              setCommits((prev) =>
                prev.map((c) =>
                  c.sha === item.sha && c.branch === branch
                    ? { ...c, status: 'error', error: e instanceof Error ? e.message : String(e) }
                    : c,
                ),
              )
            }
          }
        }
        setLastPolledAt(new Date())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        busyRef.current = false
        setPolling(false)
      }
    },
    [client, repo, branches],
  )

  const initializedBranchesRef = useRef<Set<string>>(new Set())

  // Initial fetch when a branch is newly selected, then poll on an interval.
  useEffect(() => {
    if (!client || !repo || branches.length === 0) return

    const isInitial = (b: string) => !initializedBranchesRef.current.has(b)
    void poll(isInitial).then(() => {
      branches.forEach((b) => initializedBranchesRef.current.add(b))
    })

    const timer = setInterval(() => {
      void poll(() => false)
    }, pollIntervalSec * 1000)
    return () => clearInterval(timer)
  }, [client, repo, branches, pollIntervalSec, poll])

  const refresh = useCallback(() => {
    void poll(() => false)
  }, [poll])

  return { commits, lastPolledAt, polling, error, refresh }
}
