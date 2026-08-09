# Commit Sentinel

A compliance monitor for GitHub repositories. It watches commits landing on the branches you choose, analyzes every change against the **OWASP Top 10 (2021)** baseline, and — with the optional graph backend — understands how each change ripples through the codebase via a **Neo4j code-structure graph** built from real AST parsing.

## Architecture

npm-workspaces monorepo:

| Package | What it is |
|---|---|
| `packages/core` | Shared TypeScript: OWASP rules engine, diff analyzer, GitHub API client, domain types. Used by both web and server. |
| `packages/web` | React 19 + Vite dashboard: connect a repo, monitor branches, view per-commit compliance evidence, run AI reviews. |
| `packages/server` | Fastify API: parses the repo into a Neo4j graph (files, imports, symbols, components, commits, findings) and answers impact queries. |

## Features

- **Connect to any GitHub repo.** Paste a personal access token to discover and pick from your repositories, or enter any public `owner/repo` manually. Tokens stay in your browser.
- **Monitor branches.** New commits are picked up on a configurable polling interval and scanned by ~30 pattern rules covering all ten OWASP categories.
- **Evidence trail per commit.** Expand any commit to see why it passed or failed: per-rule evaluation counts, the matched lines of code, and every file's scan record.
- **Code-structure graph (Neo4j).** The server ingests the repo — TypeScript/JavaScript files are parsed with the TypeScript compiler AST (imports, re-exports, `require`/dynamic imports, exported symbols), Python via import parsing — into a graph: `(File)-[:IMPORTS]->(File)`, `(File)-[:DECLARES]->(Symbol)`, `(File)-[:PART_OF]->(Component)`, `(Commit)-[:MODIFIES]->(File)`, `(Finding)-[:AFFECTS]->(File)`. Every analyzed commit is recorded into the graph automatically.
- **Impact-aware AI review (Anthropic).** With an Anthropic API key, Claude triages each finding against the diff **plus dependency-graph context**: which files import the changed files (direct and transitive), exported symbols, affected components, prior findings in the area, and historically co-changed files. Verdicts, explanations, and the graph context used are saved locally per commit.

## Getting started

```bash
npm install

# 1. Start Neo4j (ships with docker-compose; browser UI at http://localhost:7474)
docker compose up -d

# 2. Start the graph API (http://localhost:8787)
npm run dev:server

# 3. Start the web app (http://localhost:5173)
npm run dev:web
```

The web app works without steps 1–2 — you just lose graph impact context in AI reviews and the dependency-graph panel.

Connect a repo in the UI, then click **Build graph** in the sidebar to ingest it. Server configuration is via environment variables (see `packages/server/.env.example`); defaults match the bundled docker-compose.

## API

- `POST /api/repos/:owner/:repo/ingest` — parse the repo tree into the graph (async; send `X-GitHub-Token` for private repos / rate limits)
- `GET  /api/repos/:owner/:repo/status` — ingestion progress + graph stats
- `POST /api/repos/:owner/:repo/commits` — record an analyzed commit (files, findings); refreshes import edges for changed files
- `POST /api/repos/:owner/:repo/impact` — `{ paths: [...] }` → dependents, symbols, components, prior findings, co-change history, and a ready-to-use `promptContext` string
- `GET  /api/health` — Neo4j connectivity check

## How the analysis works

For each new commit on a monitored branch, the app fetches the commit's unified diff and runs every **added line** through pattern rules mapped to OWASP Top 10 categories. A commit is marked **Compliant** (no findings), **Warnings** (medium/low only), or **Violations** (high/critical). This is a lightweight static-pattern baseline, not a full SAST engine — the AI review layer exists precisely to arbitrate its findings with real code context. The rule set lives in `packages/core/src/compliance/owasp.ts`.

## Notes & limits

- Import resolution covers relative JS/TS imports (with extension/index probing) and Python module paths; tsconfig path aliases and dynamic non-literal imports are not resolved.
- Repo ingestion costs one GitHub API request per source file (capped at 1,500 files) — use a token.
- Graph re-ingestion replaces file structure edges; commit/finding history is preserved.
