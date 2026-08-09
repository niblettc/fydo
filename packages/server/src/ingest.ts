import { GitHubClient } from '@fydo/core'
import { config } from './config'
import type { Graph, IngestedFile } from './graph'
import { detectLanguage, parseFile } from './parse'
import { ImportResolver, componentForPath } from './resolve'

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

const IGNORED_PATHS = /(^|\/)(node_modules|dist|build|out|vendor|venv|\.venv|__pycache__|coverage)(\/|$)|\.min\.(js|css)$|\.d\.ts$/

const jobs = new Map<string, IngestJob>()

export function getJob(repoFullName: string): IngestJob | null {
  return jobs.get(repoFullName) ?? null
}

export function startIngest(
  graph: Graph,
  owner: string,
  repo: string,
  token: string,
): IngestJob {
  const fullName = `${owner}/${repo}`
  const existing = jobs.get(fullName)
  if (existing?.state === 'running') return existing

  const job: IngestJob = {
    state: 'running',
    headSha: null,
    filesTotal: 0,
    filesParsed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    truncatedTree: false,
  }
  jobs.set(fullName, job)

  void runIngest(graph, owner, repo, token, job).catch((e: unknown) => {
    job.state = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.finishedAt = new Date().toISOString()
  })

  return job
}

async function runIngest(
  graph: Graph,
  owner: string,
  repo: string,
  token: string,
  job: IngestJob,
) {
  const fullName = `${owner}/${repo}`
  const gh = new GitHubClient(token)

  const repoInfo = await gh.getRepo(owner, repo)
  const branches = await gh.getBranches(owner, repo)
  const head = branches.find((b) => b.name === repoInfo.defaultBranch)
  const headSha = head?.headSha ?? repoInfo.defaultBranch
  job.headSha = headSha

  const { entries, truncated } = await gh.getTree(owner, repo, headSha)
  job.truncatedTree = truncated

  const sourceEntries = entries
    .filter(
      (e) =>
        e.type === 'blob' &&
        detectLanguage(e.path) !== null &&
        !IGNORED_PATHS.test(e.path) &&
        (e.size ?? 0) <= config.ingest.maxFileBytes,
    )
    .slice(0, config.ingest.maxFiles)
  job.filesTotal = sourceEntries.length

  // All repo paths (not just source) so imports of e.g. JSON files still resolve
  const resolver = new ImportResolver(
    entries.filter((e) => e.type === 'blob').map((e) => e.path),
  )

  const ingested: IngestedFile[] = []
  let cursor = 0

  async function worker() {
    while (cursor < sourceEntries.length) {
      const entry = sourceEntries[cursor++]
      try {
        const content = await gh.getBlob(owner, repo, entry.sha)
        const parsed = parseFile(entry.path, content)
        if (!parsed) continue
        const language = detectLanguage(entry.path)!
        const imports: string[] = []
        const packages = new Set<string>()
        for (const spec of parsed.importSpecifiers) {
          const resolved = resolver.resolve(entry.path, spec, language)
          if (resolved?.type === 'file') imports.push(resolved.path)
          else if (resolved?.type === 'package') packages.add(resolved.name)
        }
        ingested.push({
          path: entry.path,
          language,
          component: componentForPath(entry.path),
          imports,
          packages: [...packages],
          symbols: parsed.symbols,
        })
      } finally {
        job.filesParsed++
      }
    }
  }

  await Promise.all(
    Array.from({ length: config.ingest.concurrency }, () => worker()),
  )

  await graph.upsertRepo(fullName, repoInfo.defaultBranch, headSha)
  await graph.writeFileGraph(fullName, ingested)

  job.state = 'done'
  job.finishedAt = new Date().toISOString()
}

/** Re-parse the given files at a ref and refresh their structure edges. */
export async function refreshFiles(
  graph: Graph,
  owner: string,
  repo: string,
  token: string,
  paths: string[],
  ref: string,
) {
  const fullName = `${owner}/${repo}`
  const gh = new GitHubClient(token)
  const sourcePaths = paths.filter((p) => detectLanguage(p) !== null && !IGNORED_PATHS.test(p))
  if (sourcePaths.length === 0) return

  const { entries } = await gh.getTree(owner, repo, ref)
  const bySha = new Map(entries.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
  const resolver = new ImportResolver(bySha.keys())

  const ingested: IngestedFile[] = []
  for (const path of sourcePaths) {
    const sha = bySha.get(path)
    if (!sha) continue
    const content = await gh.getBlob(owner, repo, sha)
    const parsed = parseFile(path, content)
    if (!parsed) continue
    const language = detectLanguage(path)!
    const imports: string[] = []
    const packages = new Set<string>()
    for (const spec of parsed.importSpecifiers) {
      const resolved = resolver.resolve(path, spec, language)
      if (resolved?.type === 'file') imports.push(resolved.path)
      else if (resolved?.type === 'package') packages.add(resolved.name)
    }
    ingested.push({
      path,
      language,
      component: componentForPath(path),
      imports,
      packages: [...packages],
      symbols: parsed.symbols,
    })
  }
  if (ingested.length > 0) await graph.writeFileGraph(fullName, ingested)
}
