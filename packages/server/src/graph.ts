import { OWASP_CATEGORIES } from '@fydo/core'
import neo4j, { Driver } from 'neo4j-driver'
import { config } from './config'
import type { ParsedSymbol } from './parse'

export interface IngestedFile {
  path: string
  language: string
  component: string
  /** Resolved repo-relative paths this file imports */
  imports: string[]
  /** External package names this file imports */
  packages: string[]
  symbols: ParsedSymbol[]
}

export interface CommitPayload {
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

export interface ImpactResult {
  changedPaths: string[]
  dependents: Array<{ changed: string; dependents: Array<{ path: string; distance: number }> }>
  exportedSymbols: Array<{ path: string; symbols: string[] }>
  componentsAffected: string[]
  downstreamComponents: string[]
  packagesUsed: Array<{ path: string; packages: string[] }>
  priorFindings: Array<{
    ruleId: string
    severity: string
    title: string
    file: string
    line: number
    sha: string
    date: string
  }>
  coChangedFiles: Array<{ path: string; count: number }>
  promptContext: string
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
  /** True when the dependent set was cut off at the node cap */
  truncated: boolean
}

/** Node cap keeps the visualization readable and the queries cheap */
const IMPACT_GRAPH_MAX_NODES = 60

const SEVERITY_RANK = ['critical', 'high', 'medium', 'low']

function worstSeverity(severities: string[]): string | null {
  for (const s of SEVERITY_RANK) if (severities.includes(s)) return s
  return null
}

const fileId = (repo: string, path: string) => `${repo}#${path}`

export class Graph {
  private driver: Driver

  constructor() {
    this.driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
      { disableLosslessIntegers: true },
    )
  }

  async close() {
    await this.driver.close()
  }

  async verifyConnectivity() {
    await this.driver.verifyConnectivity()
  }

  private async run(query: string, params: Record<string, unknown> = {}) {
    return this.driver.executeQuery(query, params)
  }

  async init() {
    const constraints = [
      'CREATE CONSTRAINT repo_name IF NOT EXISTS FOR (r:Repository) REQUIRE r.fullName IS UNIQUE',
      'CREATE CONSTRAINT file_id IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE',
      'CREATE CONSTRAINT commit_id IF NOT EXISTS FOR (c:Commit) REQUIRE c.id IS UNIQUE',
      'CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE',
      'CREATE CONSTRAINT finding_id IF NOT EXISTS FOR (fd:Finding) REQUIRE fd.id IS UNIQUE',
      'CREATE CONSTRAINT component_id IF NOT EXISTS FOR (co:Component) REQUIRE co.id IS UNIQUE',
      'CREATE CONSTRAINT package_name IF NOT EXISTS FOR (p:Package) REQUIRE p.name IS UNIQUE',
      'CREATE CONSTRAINT owasp_id IF NOT EXISTS FOR (o:OwaspCategory) REQUIRE o.id IS UNIQUE',
    ]
    for (const c of constraints) await this.run(c)

    await this.run(
      `UNWIND $cats AS cat
       MERGE (o:OwaspCategory {id: cat.id})
       SET o.code = cat.code, o.name = cat.name, o.description = cat.description`,
      { cats: OWASP_CATEGORIES },
    )
  }

  async upsertRepo(fullName: string, defaultBranch: string, ingestedSha: string) {
    await this.run(
      `MERGE (r:Repository {fullName: $fullName})
       SET r.defaultBranch = $defaultBranch, r.ingestedSha = $ingestedSha,
           r.ingestedAt = datetime()`,
      { fullName, defaultBranch, ingestedSha },
    )
  }

  async getRepoMeta(fullName: string): Promise<{ ingestedSha: string } | null> {
    const res = await this.run(
      'MATCH (r:Repository {fullName: $fullName}) RETURN r.ingestedSha AS ingestedSha',
      { fullName },
    )
    const rec = res.records[0]
    return rec ? { ingestedSha: rec.get('ingestedSha') as string } : null
  }

  /** Batch-write files, components, symbols, and import edges for a repo. */
  async writeFileGraph(repo: string, files: IngestedFile[]) {
    const fileRows = files.map((f) => ({
      id: fileId(repo, f.path),
      path: f.path,
      language: f.language,
      componentId: `${repo}#${f.component}`,
      componentName: f.component,
    }))

    // Nodes + PART_OF, clearing stale outgoing structure edges first so
    // re-ingestion replaces rather than accumulates.
    await this.run(
      `UNWIND $rows AS row
       MERGE (f:File {id: row.id})
       SET f.repo = $repo, f.path = row.path, f.language = row.language
       WITH f, row
       CALL (f) {
         MATCH (f)-[r:IMPORTS|IMPORTS_PACKAGE|DECLARES|PART_OF]->()
         DELETE r
       }
       MERGE (c:Component {id: row.componentId})
       SET c.repo = $repo, c.name = row.componentName
       MERGE (f)-[:PART_OF]->(c)`,
      { repo, rows: fileRows },
    )

    const importRows = files.flatMap((f) =>
      f.imports.map((target) => ({
        from: fileId(repo, f.path),
        to: fileId(repo, target),
        toPath: target,
      })),
    )
    if (importRows.length > 0) {
      await this.run(
        `UNWIND $rows AS row
         MATCH (a:File {id: row.from})
         MERGE (b:File {id: row.to})
         ON CREATE SET b.repo = $repo, b.path = row.toPath
         MERGE (a)-[:IMPORTS]->(b)`,
        { repo, rows: importRows },
      )
    }

    const packageRows = files.flatMap((f) =>
      f.packages.map((name) => ({ from: fileId(repo, f.path), name })),
    )
    if (packageRows.length > 0) {
      await this.run(
        `UNWIND $rows AS row
         MATCH (f:File {id: row.from})
         MERGE (p:Package {name: row.name})
         MERGE (f)-[:IMPORTS_PACKAGE]->(p)`,
        { rows: packageRows },
      )
    }

    const symbolRows = files.flatMap((f) =>
      f.symbols.map((s) => ({
        from: fileId(repo, f.path),
        id: `${repo}#${f.path}#${s.name}`,
        name: s.name,
        kind: s.kind,
        exported: s.exported,
      })),
    )
    if (symbolRows.length > 0) {
      await this.run(
        `UNWIND $rows AS row
         MATCH (f:File {id: row.from})
         MERGE (s:Symbol {id: row.id})
         SET s.name = row.name, s.kind = row.kind, s.exported = row.exported, s.repo = $repo
         MERGE (f)-[:DECLARES]->(s)`,
        { repo, rows: symbolRows },
      )
    }
  }

  async recordCommit(repo: string, payload: CommitPayload) {
    const commitId = `${repo}#${payload.sha}`
    await this.run(
      `MATCH (r:Repository {fullName: $repo})
       MERGE (c:Commit {id: $commitId})
       SET c.repo = $repo, c.sha = $sha, c.branch = $branch, c.message = $message,
           c.author = $author, c.date = $date, c.status = $status
       MERGE (c)-[:IN_REPO]->(r)`,
      { repo, commitId, ...payload, findings: undefined, files: undefined },
    )

    if (payload.files.length > 0) {
      await this.run(
        `UNWIND $rows AS row
         MATCH (c:Commit {id: $commitId})
         MERGE (f:File {id: row.id})
         ON CREATE SET f.repo = $repo, f.path = row.path
         MERGE (c)-[m:MODIFIES]->(f)
         SET m.status = row.status, m.additions = row.additions, m.deletions = row.deletions`,
        {
          repo,
          commitId,
          rows: payload.files.map((f) => ({ id: fileId(repo, f.path), ...f })),
        },
      )
    }

    if (payload.findings.length > 0) {
      await this.run(
        `UNWIND $rows AS row
         MATCH (c:Commit {id: $commitId})
         MERGE (fd:Finding {id: row.id})
         SET fd.repo = $repo, fd.ruleId = row.ruleId, fd.owaspId = row.owaspId,
             fd.severity = row.severity, fd.title = row.title, fd.file = row.file,
             fd.line = row.line, fd.snippet = row.snippet
         MERGE (fd)-[:FOUND_IN]->(c)
         WITH fd, row
         MATCH (o:OwaspCategory {id: row.owaspId})
         MERGE (fd)-[:VIOLATES]->(o)
         WITH fd, row
         MERGE (af:File {id: row.fileId})
         ON CREATE SET af.repo = $repo, af.path = row.file
         MERGE (fd)-[:AFFECTS]->(af)`,
        {
          repo,
          commitId,
          rows: payload.findings.map((f) => ({
            id: `${repo}#${payload.sha}#${f.ruleId}#${f.file}#${f.line}`,
            fileId: fileId(repo, f.file),
            ...f,
          })),
        },
      )
    }
  }

  async impact(repo: string, paths: string[]): Promise<ImpactResult> {
    const ids = paths.map((p) => fileId(repo, p))

    const [dependentsRes, symbolsRes, componentsRes, packagesRes, findingsRes, coChangeRes] =
      await Promise.all([
        this.run(
          `MATCH (f:File) WHERE f.id IN $ids
           OPTIONAL MATCH p = (dep:File)-[:IMPORTS*1..3]->(f)
           WITH f, dep, min(length(p)) AS distance
           WHERE dep IS NOT NULL AND NOT dep.id IN $ids
           WITH f, collect({path: dep.path, distance: distance})[..50] AS deps
           RETURN f.path AS changed, deps`,
          { ids },
        ),
        this.run(
          `MATCH (f:File)-[:DECLARES]->(s:Symbol {exported: true}) WHERE f.id IN $ids
           RETURN f.path AS path, collect(s.name)[..20] AS symbols`,
          { ids },
        ),
        this.run(
          `MATCH (f:File)-[:PART_OF]->(c:Component) WHERE f.id IN $ids
           WITH collect(DISTINCT c.name) AS affected
           OPTIONAL MATCH (g:File)-[:IMPORTS*1..3]->(h:File)-[:PART_OF]->(ac:Component)
           WHERE h.id IN $ids AND ac.name IN affected
           OPTIONAL MATCH (g)-[:PART_OF]->(dc:Component)
           WITH affected, collect(DISTINCT dc.name) AS downstream
           RETURN affected, [d IN downstream WHERE NOT d IN affected] AS downstream`,
          { ids },
        ),
        this.run(
          `MATCH (f:File)-[:IMPORTS_PACKAGE]->(p:Package) WHERE f.id IN $ids
           RETURN f.path AS path, collect(p.name) AS packages`,
          { ids },
        ),
        this.run(
          `MATCH (fd:Finding {repo: $repo})-[:AFFECTS]->(f:File) WHERE f.id IN $ids
           MATCH (fd)-[:FOUND_IN]->(c:Commit)
           RETURN fd.ruleId AS ruleId, fd.severity AS severity, fd.title AS title,
                  fd.file AS file, fd.line AS line, c.sha AS sha, c.date AS date
           ORDER BY c.date DESC LIMIT 20`,
          { repo, ids },
        ),
        this.run(
          `MATCH (c:Commit {repo: $repo})-[:MODIFIES]->(f:File) WHERE f.id IN $ids
           MATCH (c)-[:MODIFIES]->(o:File) WHERE NOT o.id IN $ids
           RETURN o.path AS path, count(DISTINCT c) AS count
           ORDER BY count DESC LIMIT 10`,
          { repo, ids },
        ),
      ])

    const dependents = dependentsRes.records.map((r) => ({
      changed: r.get('changed') as string,
      dependents: (r.get('deps') as Array<{ path: string; distance: number }>) ?? [],
    }))
    const exportedSymbols = symbolsRes.records.map((r) => ({
      path: r.get('path') as string,
      symbols: r.get('symbols') as string[],
    }))
    const compRec = componentsRes.records[0]
    const componentsAffected = (compRec?.get('affected') as string[]) ?? []
    const downstreamComponents = (compRec?.get('downstream') as string[]) ?? []
    const packagesUsed = packagesRes.records.map((r) => ({
      path: r.get('path') as string,
      packages: r.get('packages') as string[],
    }))
    const priorFindings = findingsRes.records.map((r) => ({
      ruleId: r.get('ruleId') as string,
      severity: r.get('severity') as string,
      title: r.get('title') as string,
      file: r.get('file') as string,
      line: r.get('line') as number,
      sha: r.get('sha') as string,
      date: r.get('date') as string,
    }))
    const coChangedFiles = coChangeRes.records.map((r) => ({
      path: r.get('path') as string,
      count: r.get('count') as number,
    }))

    const result: ImpactResult = {
      changedPaths: paths,
      dependents,
      exportedSymbols,
      componentsAffected,
      downstreamComponents,
      packagesUsed,
      priorFindings,
      coChangedFiles,
      promptContext: '',
    }
    result.promptContext = buildPromptContext(result)
    return result
  }

  /** Explicit nodes + import edges around a set of changed files, for the
   * commit impact-map visualization. Unlike impact(), which flattens
   * dependents into prompt text, this preserves the graph structure. */
  async impactSubgraph(repo: string, paths: string[]): Promise<ImpactGraph> {
    const ids = paths.map((p) => fileId(repo, p))
    const depLimit = Math.max(0, IMPACT_GRAPH_MAX_NODES - paths.length)

    const depsRes = await this.run(
      `MATCH (f:File) WHERE f.id IN $ids
       MATCH p = (dep:File)-[:IMPORTS*1..3]->(f)
       WHERE NOT dep.id IN $ids
       WITH dep, min(length(p)) AS distance
       ORDER BY distance ASC, dep.path ASC
       LIMIT ${depLimit + 1}
       RETURN dep.id AS id, dep.path AS path, distance`,
      { ids },
    )

    const truncated = depsRes.records.length > depLimit
    const depRecords = depsRes.records.slice(0, depLimit).map((r) => ({
      id: r.get('id') as string,
      path: r.get('path') as string,
      distance: r.get('distance') as number,
    }))

    const allIds = [...ids, ...depRecords.map((d) => d.id)]
    const [metaRes, edgesRes] = await Promise.all([
      this.run(
        `MATCH (f:File) WHERE f.id IN $allIds
         OPTIONAL MATCH (f)-[:PART_OF]->(c:Component)
         OPTIONAL MATCH (fd:Finding {repo: $repo})-[:AFFECTS]->(f)
         RETURN f.id AS id, c.name AS component, collect(DISTINCT fd.severity) AS severities`,
        { allIds, repo },
      ),
      this.run(
        `MATCH (a:File)-[:IMPORTS]->(b:File)
         WHERE a.id IN $allIds AND b.id IN $allIds
         RETURN DISTINCT a.path AS source, b.path AS target`,
        { allIds },
      ),
    ])

    const meta = new Map(
      metaRes.records.map((r) => [
        r.get('id') as string,
        {
          component: (r.get('component') as string | null) ?? null,
          severity: worstSeverity((r.get('severities') as string[]) ?? []),
        },
      ]),
    )

    // Changed files are included even when absent from the graph (e.g. files
    // the ingester skipped), so the map always shows what the commit touched.
    const nodes: ImpactGraphNode[] = paths.map((path) => {
      const m = meta.get(fileId(repo, path))
      return {
        path,
        changed: true,
        distance: 0,
        component: m?.component ?? null,
        severity: m?.severity ?? null,
      }
    })
    for (const dep of depRecords) {
      const m = meta.get(dep.id)
      nodes.push({
        path: dep.path,
        changed: false,
        distance: dep.distance,
        component: m?.component ?? null,
        severity: m?.severity ?? null,
      })
    }

    const edges = edgesRes.records.map((r) => ({
      source: r.get('source') as string,
      target: r.get('target') as string,
    }))

    return { nodes, edges, truncated }
  }

  async stats(repo: string) {
    const res = await this.run(
      `MATCH (f:File {repo: $repo})
       WITH count(f) AS files
       OPTIONAL MATCH (:File {repo: $repo})-[i:IMPORTS]->()
       WITH files, count(i) AS imports
       OPTIONAL MATCH (s:Symbol {repo: $repo})
       WITH files, imports, count(s) AS symbols
       OPTIONAL MATCH (c:Commit {repo: $repo})
       WITH files, imports, symbols, count(c) AS commits
       OPTIONAL MATCH (fd:Finding {repo: $repo})
       RETURN files, imports, symbols, commits, count(fd) AS findings`,
      { repo },
    )
    const r = res.records[0]
    return {
      files: (r?.get('files') as number) ?? 0,
      imports: (r?.get('imports') as number) ?? 0,
      symbols: (r?.get('symbols') as number) ?? 0,
      commits: (r?.get('commits') as number) ?? 0,
      findings: (r?.get('findings') as number) ?? 0,
    }
  }
}

function buildPromptContext(impact: ImpactResult): string {
  const lines: string[] = []

  for (const d of impact.dependents) {
    if (d.dependents.length === 0) {
      lines.push(`- ${d.changed}: no known dependents (leaf module)`)
      continue
    }
    const direct = d.dependents.filter((x) => x.distance === 1).map((x) => x.path)
    const transitive = d.dependents.length - direct.length
    lines.push(
      `- ${d.changed}: imported directly by ${direct.length} file(s)` +
        (direct.length > 0 ? ` (${direct.slice(0, 8).join(', ')}${direct.length > 8 ? ', …' : ''})` : '') +
        (transitive > 0 ? `, plus ${transitive} transitive dependent(s) within 3 hops` : ''),
    )
  }

  for (const s of impact.exportedSymbols) {
    if (s.symbols.length > 0) lines.push(`- ${s.path} exports: ${s.symbols.join(', ')}`)
  }

  if (impact.componentsAffected.length > 0) {
    lines.push(`- Components touched: ${impact.componentsAffected.join(', ')}`)
  }
  if (impact.downstreamComponents.length > 0) {
    lines.push(`- Downstream components that depend on this change: ${impact.downstreamComponents.join(', ')}`)
  }

  if (impact.priorFindings.length > 0) {
    lines.push('- Prior security findings in the affected files:')
    for (const f of impact.priorFindings.slice(0, 8)) {
      lines.push(`    - [${f.severity}] ${f.ruleId} ${f.title} at ${f.file}:${f.line} (commit ${f.sha.slice(0, 7)})`)
    }
  }

  if (impact.coChangedFiles.length > 0) {
    lines.push(
      `- Files that historically change together with these: ${impact.coChangedFiles
        .map((c) => `${c.path} (${c.count}x)`)
        .join(', ')}`,
    )
  }

  return lines.join('\n')
}
