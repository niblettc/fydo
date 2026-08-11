import cors from '@fastify/cors'
import Fastify from 'fastify'
import { reviewCommit } from './ai'
import type { ReviewCommitInput } from './ai'
import { supabaseConfigured, verifySupabaseUser } from './auth'
import { config } from './config'
import { Graph } from './graph'
import type { CommitPayload } from './graph'
import { getJob, refreshFiles, startIngest } from './ingest'
import type { AnalysisReport } from '@fydo/core'

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })

const graph = new Graph()

interface RepoParams {
  owner: string
  repo: string
}

function tokenFrom(headers: Record<string, unknown>): string {
  const header = headers['x-github-token']
  return typeof header === 'string' && header ? header : config.githubToken
}

app.get('/api/health', async () => {
  try {
    await graph.verifyConnectivity()
    return { ok: true, neo4j: 'connected' }
  } catch (e) {
    return { ok: false, neo4j: e instanceof Error ? e.message : String(e) }
  }
})

app.post<{ Params: RepoParams }>('/api/repos/:owner/:repo/ingest', async (req) => {
  const { owner, repo } = req.params
  const job = startIngest(graph, owner, repo, tokenFrom(req.headers))
  return { job }
})

app.get<{ Params: RepoParams }>('/api/repos/:owner/:repo/status', async (req) => {
  const { owner, repo } = req.params
  const fullName = `${owner}/${repo}`
  const [meta, stats] = await Promise.all([
    graph.getRepoMeta(fullName),
    graph.stats(fullName),
  ])
  return { job: getJob(fullName), ingestedSha: meta?.ingestedSha ?? null, stats }
})

app.post<{ Params: RepoParams; Body: CommitPayload }>(
  '/api/repos/:owner/:repo/commits',
  async (req) => {
    const { owner, repo } = req.params
    const fullName = `${owner}/${repo}`
    const payload = req.body
    await graph.recordCommit(fullName, payload)

    // Refresh dependency edges for the changed source files in the background;
    // failures here must not fail the recording itself.
    const changedPaths = payload.files
      .filter((f) => f.status !== 'removed')
      .map((f) => f.path)
    void refreshFiles(graph, owner, repo, tokenFrom(req.headers), changedPaths, payload.sha).catch(
      (e: unknown) => {
        app.log.warn(`import refresh failed for ${fullName}@${payload.sha}: ${String(e)}`)
      },
    )

    return { recorded: true }
  },
)

app.post<{ Params: RepoParams; Body: { commit: ReviewCommitInput; report: AnalysisReport } }>(
  '/api/repos/:owner/:repo/reviews',
  async (req, reply) => {
    if (!supabaseConfigured()) {
      return reply.code(503).send({ error: 'Server is missing SUPABASE_URL / SUPABASE_ANON_KEY.' })
    }
    const userId = await verifySupabaseUser(req.headers.authorization)
    if (!userId) {
      return reply.code(401).send({ error: 'Sign in required for AI reviews.' })
    }
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ error: 'Server is missing ANTHROPIC_API_KEY.' })
    }

    const { commit, report } = req.body ?? {}
    if (!commit || typeof commit.message !== 'string' || !report || !Array.isArray(report.fileScans)) {
      return reply.code(400).send({ error: 'body must include "commit" and "report"' })
    }

    const { owner, repo } = req.params
    const fullName = `${owner}/${repo}`

    // Graph impact context is best-effort: the review proceeds without it if
    // Neo4j is down or the repo has no ingested graph yet.
    let impactContext: string | undefined
    const changedPaths = report.fileScans.map((f) => f.filename).slice(0, 50)
    if (changedPaths.length > 0) {
      try {
        const impact = await graph.impact(fullName, changedPaths)
        impactContext = impact.promptContext || undefined
      } catch (e) {
        app.log.warn(`impact context unavailable for ${fullName}: ${String(e)}`)
      }
    }

    const review = await reviewCommit(config.anthropicApiKey, commit, report, impactContext)
    return { review }
  },
)

app.post<{ Params: RepoParams; Body: { paths: string[] } }>(
  '/api/repos/:owner/:repo/impact',
  async (req, reply) => {
    const { owner, repo } = req.params
    const paths = req.body?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return reply.code(400).send({ error: 'body must include a non-empty "paths" array' })
    }
    return graph.impact(`${owner}/${repo}`, paths.slice(0, 50))
  },
)

app.post<{ Params: RepoParams; Body: { paths: string[] } }>(
  '/api/repos/:owner/:repo/impact-graph',
  async (req, reply) => {
    const { owner, repo } = req.params
    const paths = req.body?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return reply.code(400).send({ error: 'body must include a non-empty "paths" array' })
    }
    return graph.impactSubgraph(`${owner}/${repo}`, paths.slice(0, 50))
  },
)

try {
  await graph.init()
  app.log.info('Neo4j constraints and OWASP categories initialized')
} catch (e) {
  app.log.warn(
    `Could not initialize Neo4j (${String(e)}). Start Neo4j (docker compose up -d) and restart the server.`,
  )
}

await app.listen({ port: config.port, host: '0.0.0.0' })
