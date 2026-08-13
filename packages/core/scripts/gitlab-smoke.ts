/** Manual smoke test: exercises GitLabClient against public gitlab.com
 * projects, including a nested namespace. Run via:
 *   npx esbuild scripts/gitlab-smoke.ts --bundle --format=esm --platform=node \
 *     --outfile=/tmp/fydo-gitlab-smoke.mjs && node /tmp/fydo-gitlab-smoke.mjs */

import { GitLabClient, splitFullName } from '../src/index'

const gl = new GitLabClient()

for (const fullName of ['gitlab-org/cli', 'gitlab-org/api/client-go']) {
  const [owner, repo] = splitFullName(fullName)
  const info = await gl.getRepo(owner, repo)
  console.log(
    'repo:',
    info.fullName,
    '| provider:',
    info.provider,
    '| default:',
    info.defaultBranch,
    '| private:',
    info.private,
    '| url:',
    info.htmlUrl,
  )
  const branches = await gl.getBranches(owner, repo)
  console.log('branches:', branches.length, 'first:', branches[0]?.name)
  const commits = await gl.getCommits(owner, repo, info.defaultBranch, 3)
  console.log(
    'commits:',
    commits.map((c) => `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0].slice(0, 40)}`),
  )
  const detail = await gl.getCommit(owner, repo, commits[0].sha)
  const f = detail.files[0]
  console.log(
    'detail:',
    detail.sha.slice(0, 7),
    'stats:',
    JSON.stringify(detail.stats),
    'files:',
    detail.files.length,
    'first:',
    f?.filename,
    f?.status,
    `+${f?.additions}`,
    `-${f?.deletions}`,
    'patch starts:',
    JSON.stringify(f?.patch?.slice(0, 30)),
  )
  console.log('commit url:', detail.html_url)
  const { entries, truncated } = await gl.getTree(owner, repo, info.defaultBranch)
  console.log('tree:', entries.length, 'entries, truncated:', truncated)
  const blobEntry = entries.find((e) => e.type === 'blob' && /\.(go|md)$/.test(e.path))!
  const content = await gl.getBlob(owner, repo, blobEntry.sha)
  console.log(
    'blob:',
    blobEntry.path,
    '->',
    content.length,
    'chars, starts:',
    JSON.stringify(content.slice(0, 40)),
  )
  console.log('---')
}
