import cors from '@fastify/cors'
import Fastify from 'fastify'
import { reviewCommit } from './ai'
import type { ReviewCommitInput } from './ai'
import { supabaseConfigured, verifySupabaseUser } from './auth'
import { config } from './config'
import { Graph } from './graph'
import type { CommitPayload } from './graph'
import { getJob, refreshFiles, startIngest } from './ingest'
import { normalizeScanPath } from '@fydo/core'
import type { AnalysisReport, GitProvider } from '@fydo/core'

const app = Fastify({ logger: true })
await app.register(cors, { origin: true })

const graph = new Graph()

/** Routes carry the provider and the URL-encoded project path (GitLab
 * namespaces can be nested, so a single :owner/:repo pair is not enough). */
interface RepoParams {
  provider: string
  project: string
}

interface RepoRef {
  provider: GitProvider
  fullName: string
  /** Neo4j key. GitHub keeps the bare path so pre-GitLab graphs stay valid. */
  graphKey: string
}

function repoRef(params: RepoParams): RepoRef | null {
  if (params.provider !== 'github' && params.provider !== 'gitlab') return null
  // Fastify may hand the param through still percent-encoded depending on
  // how the client encoded slashes; project paths never contain a literal %.
  const fullName = params.project.includes('%')
    ? decodeURIComponent(params.project)
    : params.project
  return {
    provider: params.provider,
    fullName,
    graphKey: params.provider === 'github' ? fullName : `gitlab:${fullName}`,
  }
}

function tokenFrom(headers: Record<string, unknown>, provider: GitProvider): string {
  for (const name of ['x-git-token', 'x-github-token']) {
    const header = headers[name]
    if (typeof header === 'string' && header) return header
  }
  // Public GitLab projects work unauthenticated; only GitHub gets the fallback.
  return provider === 'github' ? config.githubToken : ''
}

app.get('/api/health', async () => {
  try {
    await graph.verifyConnectivity()
    return { ok: true, neo4j: 'connected' }
  } catch (e) {
    return { ok: false, neo4j: e instanceof Error ? e.message : String(e) }
  }
})

app.post<{ Params: RepoParams; Body: { scanPath?: string } | null }>(
  '/api/repos/:provider/:project/ingest',
  async (req, reply) => {
    const ref = repoRef(req.params)
    if (!ref) return reply.code(400).send({ error: 'unknown provider' })
    const scanPath = normalizeScanPath(req.body?.scanPath)
    const job = startIngest(
      graph,
      ref.provider,
      ref.fullName,
      ref.graphKey,
      tokenFrom(req.headers, ref.provider),
      scanPath,
    )
    return { job }
  },
)

app.get<{ Params: RepoParams }>('/api/repos/:provider/:project/status', async (req, reply) => {
  const ref = repoRef(req.params)
  if (!ref) return reply.code(400).send({ error: 'unknown provider' })
  const [meta, stats] = await Promise.all([
    graph.getRepoMeta(ref.graphKey),
    graph.stats(ref.graphKey),
  ])
  return { job: getJob(ref.graphKey), ingestedSha: meta?.ingestedSha ?? null, stats }
})

app.post<{ Params: RepoParams; Body: CommitPayload & { scanPath?: string } }>(
  '/api/repos/:provider/:project/commits',
  async (req, reply) => {
    const ref = repoRef(req.params)
    if (!ref) return reply.code(400).send({ error: 'unknown provider' })
    const { scanPath: rawScanPath, ...payload } = req.body
    const scanPath = normalizeScanPath(rawScanPath)
    await graph.recordCommit(ref.graphKey, payload)

    // Refresh dependency edges for the changed source files in the background;
    // failures here must not fail the recording itself.
    const changedPaths = payload.files
      .filter((f) => f.status !== 'removed')
      .map((f) => f.path)
    void refreshFiles(
      graph,
      ref.provider,
      ref.fullName,
      ref.graphKey,
      tokenFrom(req.headers, ref.provider),
      changedPaths,
      payload.sha,
      scanPath,
    ).catch((e: unknown) => {
      app.log.warn(`import refresh failed for ${ref.graphKey}@${payload.sha}: ${String(e)}`)
    })

    return { recorded: true }
  },
)

app.post<{ Params: RepoParams; Body: { commit: ReviewCommitInput; report: AnalysisReport } }>(
  '/api/repos/:provider/:project/reviews',
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

    const ref = repoRef(req.params)
    if (!ref) return reply.code(400).send({ error: 'unknown provider' })

    // Graph impact context is best-effort: the review proceeds without it if
    // Neo4j is down or the repo has no ingested graph yet.
    let impactContext: string | undefined
    const changedPaths = report.fileScans.map((f) => f.filename).slice(0, 50)
    if (changedPaths.length > 0) {
      try {
        const impact = await graph.impact(ref.graphKey, changedPaths)
        impactContext = impact.promptContext || undefined
      } catch (e) {
        app.log.warn(`impact context unavailable for ${ref.graphKey}: ${String(e)}`)
      }
    }

    const review = await reviewCommit(config.anthropicApiKey, commit, report, impactContext)
    return { review }
  },
)

app.post<{ Params: RepoParams; Body: { paths: string[] } }>(
  '/api/repos/:provider/:project/impact',
  async (req, reply) => {
    const ref = repoRef(req.params)
    if (!ref) return reply.code(400).send({ error: 'unknown provider' })
    const paths = req.body?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return reply.code(400).send({ error: 'body must include a non-empty "paths" array' })
    }
    return graph.impact(ref.graphKey, paths.slice(0, 50))
  },
)

app.post<{ Params: RepoParams; Body: { paths: string[] } }>(
  '/api/repos/:provider/:project/impact-graph',
  async (req, reply) => {
    const ref = repoRef(req.params)
    if (!ref) return reply.code(400).send({ error: 'unknown provider' })
    const paths = req.body?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return reply.code(400).send({ error: 'body must include a non-empty "paths" array' })
    }
    return graph.impactSubgraph(ref.graphKey, paths.slice(0, 50))
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
