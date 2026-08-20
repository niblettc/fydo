/** Scan-path scoping: a project can restrict analysis to one directory of a
 * repo (monorepos with multiple products). Commit listing is filtered by the
 * provider API; these helpers scope everything derived from commit details. */

import type { CommitDetail } from './github'

/** Cleans user input into a repo-relative directory path, or null for "whole repo" */
export function normalizeScanPath(input: string | null | undefined): string | null {
  const cleaned = (input ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
  return cleaned === '' ? null : cleaned
}

export function isInScanPath(path: string, scanPath: string | null): boolean {
  return scanPath === null || path.startsWith(`${scanPath}/`)
}

/** Drops out-of-scope files from a commit detail and recomputes its stats,
 * so analysis, findings, and graph recording only see the scoped directory. */
export function scopeCommitDetail(detail: CommitDetail, scanPath: string | null): CommitDetail {
  if (scanPath === null) return detail
  const files = detail.files.filter((f) => isInScanPath(f.filename, scanPath))
  const additions = files.reduce((n, f) => n + f.additions, 0)
  const deletions = files.reduce((n, f) => n + f.deletions, 0)
  return { ...detail, files, stats: { additions, deletions, total: additions + deletions } }
}
