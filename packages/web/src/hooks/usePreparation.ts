import { useCallback, useRef, useState } from 'react'
import { analyzeCommit, statusForFindings } from '@fydo/core'
import type { AiReview, AnalyzedCommit, GitClient, RepoInfo } from '@fydo/core'
import {
  fetchGraphStatus,
  recordCommitToGraph,
  requestAiReview,
  startGraphIngest,
} from '../backend'
import type { GraphStats } from '../backend'
import { saveAiReviews, saveCommitAnalyses, upsertRepo } from '../db'
import type { RepoRow } from '../db'
import { supabase } from '../supabase'

const COMMITS_PER_BRANCH = 5

export type StageId = 'graph' | 'commits' | 'ai' | 'save'

export const STAGE_ORDER: StageId[] = ['graph', 'commits', 'ai', 'save']

export const STAGE_LABELS: Record<StageId, string> = {
  graph: 'Building dependency graph',
  commits: 'Analyzing recent commits',
  ai: 'AI security review',
  save: 'Saving results',
}

export interface StageState {
  status: 'pending' | 'running' | 'done' | 'failed'
  progress?: { done: number; total: number }
  error?: string
}

export interface PreparationResult {
  commits: AnalyzedCommit[]
  reviews: Record<string, AiReview>
  repoRow: RepoRow
  graphStats: GraphStats | null
}

export interface PreparationState {
  stages: Record<StageId, StageState>
  status: 'idle' | 'running' | 'failed' | 'done'
  result: PreparationResult | null
  start: () => void
  retry: () => void
}

function initialStages(): Record<StageId, StageState> {
  return {
    graph: { status: 'pending' },
    commits: { status: 'pending' },
    ai: { status: 'pending' },
    save: { status: 'pending' },
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function friendlyGraphError(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e)
  if (e instanceof TypeError || /fetch/i.test(message)) {
    return new Error(
      'Graph backend not reachable. Start it with "npm run dev:server" and Neo4j with "docker compose up -d", then retry.',
    )
  }
  return new Error(message)
}

/** Runs the mandatory setup pipeline: graph ingest, initial commit analysis,
 * AI reviews, and persistence to Supabase. Retry resumes at the failed stage,
 * keeping the work of completed stages. */
export function usePreparation(
  client: GitClient,
  repo: RepoInfo,
  selectedBranches: string[],
  framework: string,
): PreparationState {
  const [stages, setStages] = useState<Record<StageId, StageState>>(initialStages)
  const [status, setStatus] = useState<PreparationState['status']>('idle')
  const [result, setResult] = useState<PreparationResult | null>(null)

  const runningRef = useRef(false)
  const failedIndexRef = useRef(0)
  const analyzedRef = useRef<Map<string, AnalyzedCommit>>(new Map())
  const reviewsRef = useRef<Record<string, AiReview>>({})
  const graphShaRef = useRef<string | null>(null)
  const graphStatsRef = useRef<GraphStats | null>(null)

  const setStage = useCallback((id: StageId, state: StageState) => {
    setStages((prev) => ({ ...prev, [id]: state }))
  }, [])

  const runGraphStage = useCallback(async () => {
    let graphStatus
    try {
      graphStatus = await fetchGraphStatus(repo.provider, repo.fullName)
    } catch (e) {
      throw friendlyGraphError(e)
    }

    const alreadyIngested =
      graphStatus.ingestedSha !== null &&
      graphStatus.stats.files > 0 &&
      graphStatus.job?.state !== 'running'

    if (!alreadyIngested && graphStatus.job?.state !== 'running') {
      try {
        await startGraphIngest(repo.provider, repo.fullName, client.getToken())
      } catch (e) {
        throw friendlyGraphError(e)
      }
    }

    while (true) {
      try {
        graphStatus = await fetchGraphStatus(repo.provider, repo.fullName)
      } catch (e) {
        throw friendlyGraphError(e)
      }
      const job = graphStatus.job
      if (job?.state === 'running') {
        setStage('graph', {
          status: 'running',
          progress: { done: job.filesParsed, total: Math.max(job.filesTotal, 1) },
        })
        await sleep(2000)
        continue
      }
      if (job?.state === 'error') {
        throw new Error(job.error ?? 'Graph build failed.')
      }
      break
    }

    if (!graphStatus.ingestedSha || graphStatus.stats.files === 0) {
      throw new Error('Graph build finished but produced no files. Retry the build.')
    }
    graphShaRef.current = graphStatus.ingestedSha
    graphStatsRef.current = graphStatus.stats
  }, [client, repo, setStage])

  const runCommitsStage = useCallback(async () => {
    const perBranch: Array<{ branch: string; shas: Array<{ sha: string }> }> = []
    for (const branch of selectedBranches) {
      const list = await client.getCommits(repo.owner, repo.repo, branch, COMMITS_PER_BRANCH)
      perBranch.push({ branch, shas: list })
    }
    const total = perBranch.reduce((n, b) => n + b.shas.length, 0)
    let done = 0
    setStage('commits', { status: 'running', progress: { done, total } })

    for (const { branch, shas } of perBranch) {
      for (const item of shas) {
        const key = `${branch}:${item.sha}`
        if (analyzedRef.current.has(key)) {
          done++
          setStage('commits', { status: 'running', progress: { done, total } })
          continue
        }
        const detail = await client.getCommit(repo.owner, repo.repo, item.sha)
        const report = analyzeCommit(detail)
        const commitStatus = statusForFindings(report.findings)
        const analyzed: AnalyzedCommit = {
          sha: detail.sha,
          branch,
          message: detail.commit.message.split('\n')[0],
          author: detail.author?.login ?? detail.commit.author?.name ?? 'unknown',
          authorAvatar: detail.author?.avatar_url,
          date: detail.commit.author?.date ?? '',
          url: detail.html_url,
          status: commitStatus,
          findings: report.findings,
          report,
          filesChanged: detail.files?.length ?? 0,
          additions: detail.stats?.additions ?? 0,
          deletions: detail.stats?.deletions ?? 0,
        }
        analyzedRef.current.set(key, analyzed)

        // Feed the graph; best-effort since the ingest already succeeded.
        void recordCommitToGraph(repo.provider, repo.fullName, client.getToken(), {
          sha: analyzed.sha,
          branch,
          message: analyzed.message,
          author: analyzed.author,
          date: analyzed.date,
          status: commitStatus,
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
        }).catch(() => {})

        done++
        setStage('commits', { status: 'running', progress: { done, total } })
      }
    }
  }, [client, repo, selectedBranches, setStage])

  const runAiStage = useCallback(async () => {
    const targets = [...analyzedRef.current.values()].filter((c) => c.report)
    // Reviews are keyed by sha; a commit on two selected branches reviews once.
    const pending = targets.filter((c) => !reviewsRef.current[c.sha])
    const total = targets.length
    let done = total - pending.length
    setStage('ai', { status: 'running', progress: { done, total } })

    const { data } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (!accessToken) throw new Error('Not signed in.')

    for (const commit of pending) {
      const { review } = await requestAiReview(repo.provider, repo.fullName, accessToken, {
        commit: { message: commit.message, branch: commit.branch },
        report: commit.report!,
      })
      reviewsRef.current[commit.sha] = review
      done++
      setStage('ai', { status: 'running', progress: { done, total } })
    }
  }, [repo, setStage])

  const runSaveStage = useCallback(async () => {
    const commits = [...analyzedRef.current.values()]
    const row = await upsertRepo({
      provider: repo.provider,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      selectedBranches,
      framework,
      graphIngestedSha: graphShaRef.current,
      onboarded: true,
    })
    await saveCommitAnalyses(row.id, commits)
    await saveAiReviews(row.id, reviewsRef.current)
    setResult({
      commits,
      reviews: { ...reviewsRef.current },
      repoRow: row,
      graphStats: graphStatsRef.current,
    })
  }, [repo, selectedBranches, framework])

  const stageRunners: Record<StageId, () => Promise<void>> = {
    graph: runGraphStage,
    commits: runCommitsStage,
    ai: runAiStage,
    save: runSaveStage,
  }
  const stageRunnersRef = useRef(stageRunners)
  stageRunnersRef.current = stageRunners

  const runFrom = useCallback(
    async (startIndex: number) => {
      if (runningRef.current) return
      runningRef.current = true
      setStatus('running')
      for (let i = startIndex; i < STAGE_ORDER.length; i++) {
        const id = STAGE_ORDER[i]
        setStage(id, { status: 'running' })
        try {
          await stageRunnersRef.current[id]()
          setStages((prev) => ({
            ...prev,
            [id]: { status: 'done', progress: prev[id].progress },
          }))
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          setStages((prev) => ({
            ...prev,
            [id]: { status: 'failed', progress: prev[id].progress, error: message },
          }))
          failedIndexRef.current = i
          setStatus('failed')
          runningRef.current = false
          return
        }
      }
      setStatus('done')
      runningRef.current = false
    },
    [setStage],
  )

  const start = useCallback(() => {
    void runFrom(0)
  }, [runFrom])

  const retry = useCallback(() => {
    void runFrom(failedIndexRef.current)
  }, [runFrom])

  return { stages, status, result, start, retry }
}
