# Commit Sentinel

A React web app that connects to a GitHub repository, monitors commits landing on the branches you choose, and analyzes every commit against a compliance baseline — starting with the **OWASP Top 10 (2021)**.

## Features

- **Connect to any GitHub repo** by name or URL, with an optional personal access token (required for private repos, and raises the API rate limit from 60 to 5,000 requests/hour). The token is stored only in your browser's localStorage and sent only to `api.github.com`.
- **Monitor one or more branches.** New commits are picked up automatically on a configurable polling interval (30s–5m), and you can trigger a check on demand.
- **OWASP Top 10 compliance analysis.** Each commit's diff is scanned by a rules engine covering all ten 2021 categories (A01–A10) — hardcoded secrets, SQL/command injection patterns, weak crypto, disabled TLS verification, insecure deserialization, SSRF patterns, and more. Findings include the file, line, code snippet, severity, OWASP category, and remediation guidance.
- **Compliance dashboard** with per-commit pass/warn/fail status, aggregate stats, and a baseline panel showing which OWASP categories have violations.
- **Evidence trail per commit.** Expanding a commit shows exactly why it passed or failed: per-rule evaluation counts, the specific matched lines of code per rule, and every file's scan record.
- **Optional AI review (Anthropic).** Paste an Anthropic API key and Claude triages each finding against the actual diff — marking it confirmed, false positive, or needs review, with an explanation and suggested action — plus an overall risk rating and any issues the pattern rules missed. Reviews are saved in localStorage per repo, so they persist across reloads. The key is stored only in your browser and sent only to `api.anthropic.com`.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL (default http://localhost:5173), enter a repository like `expressjs/express`, and optionally paste a GitHub personal access token (a fine-grained token with read-only **Contents** access is sufficient).

## How the analysis works

For each new commit on a monitored branch, the app fetches the commit's unified diff from the GitHub API and runs every **added line** through ~30 pattern-based rules mapped to OWASP Top 10 categories. A commit is marked:

- **Compliant** — no findings
- **Warnings** — only medium/low-severity findings
- **Violations** — at least one high/critical finding

This is a lightweight static-pattern baseline, not a full SAST engine — treat findings as review prompts rather than verdicts. The rule set lives in `src/compliance/owasp.ts` and is easy to extend with additional rules or entirely new baselines (e.g. CWE Top 25, PCI DSS).

## Tech

- React 19 + TypeScript + Vite
- GitHub REST API (no backend required — everything runs in the browser)
