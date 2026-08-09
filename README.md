# Commit Sentinel

A compliance monitor for GitHub repositories. Sign in with GitHub, pick a repo, and a guided setup builds a **Neo4j code-structure graph** from real AST parsing, analyzes recent commits against the **OWASP Top 10 (2021)** baseline, and AI-reviews every finding. User accounts and analysis history are persisted in **Supabase**, so returning users land straight on their dashboard.

## Architecture

npm-workspaces monorepo:

| Package | What it is |
|---|---|
| `packages/core` | Shared TypeScript: OWASP rules engine, diff analyzer, GitHub API client, domain types. Used by both web and server. |
| `packages/web` | React 19 + Vite dashboard: guided onboarding, branch monitoring, per-commit compliance evidence, AI reviews. |
| `packages/server` | Fastify API: parses the repo into a Neo4j graph (files, imports, symbols, components, commits, findings), answers impact queries, and runs AI reviews with a server-side Anthropic key. |

## Features

- **Sign in with GitHub.** Supabase Auth (GitHub OAuth) provides the account and the GitHub access token in one step — no personal access tokens to paste.
- **Guided onboarding.** Pick a repository, confirm the compliance framework (OWASP Top 10 2021), choose branches, then watch real progress as the dependency graph is built, recent commits are analyzed, and each one is AI-reviewed.
- **Monitor branches.** New commits are picked up on a configurable polling interval, scanned by ~30 pattern rules covering all ten OWASP categories, AI-reviewed automatically, and saved to your account.
- **Evidence trail per commit.** Expand any commit to see why it passed or failed: per-rule evaluation counts, the matched lines of code, and every file's scan record.
- **Code-structure graph (Neo4j).** Built during onboarding: TypeScript/JavaScript files are parsed with the TypeScript compiler AST (imports, re-exports, `require`/dynamic imports, exported symbols), Python via import parsing — into a graph: `(File)-[:IMPORTS]->(File)`, `(File)-[:DECLARES]->(Symbol)`, `(File)-[:PART_OF]->(Component)`, `(Commit)-[:MODIFIES]->(File)`, `(Finding)-[:AFFECTS]->(File)`. Every analyzed commit is recorded into the graph automatically.
- **Impact-aware AI review (Anthropic).** Claude triages each finding against the diff **plus dependency-graph context**: which files import the changed files (direct and transitive), exported symbols, affected components, prior findings in the area, and historically co-changed files. Reviews run through the backend with a server-side key and are stored in Supabase.

## Getting started

One-time Supabase setup:

1. Create a Supabase project and apply `supabase/migrations/20260809000000_init.sql` (SQL editor or `supabase db push`).
2. Enable the **GitHub** auth provider (Supabase dashboard → Authentication → Providers) with a GitHub OAuth app's client id/secret.
3. Copy `packages/web/.env.example` to `packages/web/.env` and `packages/server/.env.example` to `packages/server/.env`, filling in the Supabase URL/anon key and the server's `ANTHROPIC_API_KEY`.

Then:

```bash
npm install

# 1. Start Neo4j (ships with docker-compose; browser UI at http://localhost:7474)
docker compose up -d

# 2. Start the backend — graph + AI reviews (http://localhost:8787)
npm run dev:server

# 3. Start the web app (http://localhost:5173)
npm run dev:web
```

All three are required: onboarding builds the dependency graph and runs AI reviews through the backend as mandatory setup stages.

## API

- `POST /api/repos/:owner/:repo/ingest` — parse the repo tree into the graph (async; send `X-GitHub-Token` for private repos / rate limits)
- `GET  /api/repos/:owner/:repo/status` — ingestion progress + graph stats
- `POST /api/repos/:owner/:repo/commits` — record an analyzed commit (files, findings); refreshes import edges for changed files
- `POST /api/repos/:owner/:repo/impact` — `{ paths: [...] }` → dependents, symbols, components, prior findings, co-change history, and a ready-to-use `promptContext` string
- `POST /api/repos/:owner/:repo/reviews` — `{ commit, report }` → AI review of the commit's findings (requires a Supabase JWT in `Authorization: Bearer`; graph impact context is added server-side when available)
- `GET  /api/health` — Neo4j connectivity check

## How the analysis works

For each new commit on a monitored branch, the app fetches the commit's unified diff and runs every **added line** through pattern rules mapped to OWASP Top 10 categories. A commit is marked **Compliant** (no findings), **Warnings** (medium/low only), or **Violations** (high/critical). This is a lightweight static-pattern baseline, not a full SAST engine — the AI review layer exists precisely to arbitrate its findings with real code context. The rule set lives in `packages/core/src/compliance/owasp.ts`.

## Notes & limits

- Import resolution covers relative JS/TS imports (with extension/index probing) and Python module paths; tsconfig path aliases and dynamic non-literal imports are not resolved.
- Repo ingestion costs one GitHub API request per source file (capped at 1,500 files) — use a token.
- Graph re-ingestion replaces file structure edges; commit/finding history is preserved.
