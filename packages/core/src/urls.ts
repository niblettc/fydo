/** Provider-aware web URL builders. GitHub uses /commit/ and /blob/;
 * GitLab uses /-/commit/ and /-/blob/. */

import type { GitProvider } from './types'

export function blobUrl(
  provider: GitProvider,
  repoHtmlUrl: string,
  sha: string,
  path: string,
  line?: number,
): string {
  const segment = provider === 'gitlab' ? '/-/blob/' : '/blob/'
  return `${repoHtmlUrl}${segment}${sha}/${path}${line != null ? `#L${line}` : ''}`
}

/** Derives the blob URL for a file from a commit's web URL, detecting the
 * provider from the URL shape. Returns undefined for unrecognized URLs. */
export function blobUrlFromCommitUrl(
  commitUrl: string,
  sha: string,
  path: string,
  line?: number,
): string | undefined {
  const gitlab = commitUrl.match(/^(.*)\/-\/commit\/.+$/)
  if (gitlab) return blobUrl('gitlab', gitlab[1], sha, path, line)
  const github = commitUrl.match(/^(.*)\/commit\/.+$/)
  if (github) return blobUrl('github', github[1], sha, path, line)
  return undefined
}
