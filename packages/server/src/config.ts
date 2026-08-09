export const config = {
  port: Number(process.env.PORT ?? 8787),
  neo4j: {
    uri: process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    user: process.env.NEO4J_USER ?? 'neo4j',
    password: process.env.NEO4J_PASSWORD ?? 'fydo-graph',
  },
  /** Fallback GitHub token when the client doesn't send one via X-GitHub-Token */
  githubToken: process.env.GITHUB_TOKEN ?? '',
  ingest: {
    maxFiles: Number(process.env.INGEST_MAX_FILES ?? 1500),
    maxFileBytes: 300_000,
    concurrency: 8,
  },
}
