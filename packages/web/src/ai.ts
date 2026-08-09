import type { AiFindingVerdict, AiReview, AnalysisReport, AnalyzedCommit } from '@fydo/core'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
export const AI_MODEL = 'claude-sonnet-4-5'

/** Keep the request well under context limits regardless of commit size */
const MAX_TOTAL_PATCH_CHARS = 24_000
const MAX_FILES = 12

const SYSTEM_PROMPT = `You are an expert application-security reviewer triaging automated OWASP Top 10 scanner findings on a git commit.

The findings come from simple regex-based rules, so false positives are common (test fixtures, example code, already-sanitized values, dead code). Judge each finding in the context of the diff provided.

Respond with ONLY a JSON object, no markdown fences, matching this schema:
{
  "summary": "2-3 sentence overall assessment of this commit's security posture",
  "overall_risk": "low" | "medium" | "high" | "critical",
  "verdicts": [
    {
      "finding_index": <number, index of the finding you are judging>,
      "verdict": "confirmed" | "false-positive" | "uncertain",
      "explanation": "1-3 sentences: why, referencing the specific code",
      "suggested_action": "concrete next step for the developer"
    }
  ],
  "additional_observations": ["security issues you see in the diff that the scanner missed, if any"]
}

Provide exactly one verdict per finding. If there are no findings, return an empty verdicts array and focus on additional_observations.`

function buildUserPrompt(
  commit: AnalyzedCommit,
  report: AnalysisReport,
  impactContext?: string,
): string {
  const findings = report.findings.map((f, i) => ({
    finding_index: i,
    rule: f.ruleId,
    owasp_category: f.owaspId,
    title: f.title,
    scanner_severity: f.severity,
    file: f.file,
    line: f.line,
    matched_code: f.snippet,
  }))

  let budget = MAX_TOTAL_PATCH_CHARS
  const diffs: string[] = []
  for (const scan of report.fileScans.slice(0, MAX_FILES)) {
    if (!scan.patch || budget <= 0) continue
    const chunk = scan.patch.slice(0, budget)
    diffs.push(`--- ${scan.filename} ---\n${chunk}`)
    budget -= chunk.length
  }

  const sections = [
    `Commit message: ${commit.message}`,
    `Branch: ${commit.branch}`,
    '',
    `Scanner findings (${findings.length}):`,
    JSON.stringify(findings, null, 2),
    '',
    'Diff (added lines are prefixed with +):',
    diffs.join('\n\n') || '(no diff content available)',
  ]

  if (impactContext) {
    sections.push(
      '',
      'Impact context from the repository dependency graph (how the changed files relate to the rest of the codebase — use this to judge blast radius and severity):',
      impactContext.slice(0, 3000),
    )
  }

  return sections.join('\n')
}

interface RawVerdict {
  finding_index?: number
  verdict?: string
  explanation?: string
  suggested_action?: string
}

function parseReview(text: string, model: string): AiReview {
  // Tolerate accidental markdown fences or prose around the JSON object
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI response did not contain JSON')
  const raw = JSON.parse(text.slice(start, end + 1)) as {
    summary?: string
    overall_risk?: string
    verdicts?: RawVerdict[]
    additional_observations?: string[]
  }

  const validVerdicts: AiFindingVerdict[] = (raw.verdicts ?? [])
    .filter(
      (v): v is Required<Pick<RawVerdict, 'finding_index' | 'verdict' | 'explanation'>> &
        RawVerdict =>
        typeof v.finding_index === 'number' &&
        typeof v.explanation === 'string' &&
        ['confirmed', 'false-positive', 'uncertain'].includes(v.verdict ?? ''),
    )
    .map((v) => ({
      findingIndex: v.finding_index,
      verdict: v.verdict as AiFindingVerdict['verdict'],
      explanation: v.explanation,
      suggestedAction: v.suggested_action,
    }))

  const risk = ['low', 'medium', 'high', 'critical'].includes(raw.overall_risk ?? '')
    ? (raw.overall_risk as AiReview['overallRisk'])
    : 'low'

  return {
    summary: raw.summary ?? 'No summary provided.',
    overallRisk: risk,
    verdicts: validVerdicts,
    additionalObservations: (raw.additional_observations ?? []).filter(
      (o) => typeof o === 'string',
    ),
    model,
    reviewedAt: new Date().toISOString(),
  }
}

export async function reviewCommit(
  apiKey: string,
  commit: AnalyzedCommit,
  report: AnalysisReport,
  impactContext?: string,
): Promise<AiReview> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required by Anthropic for browser-originated requests
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(commit, report, impactContext) }],
    }),
  })

  if (!res.ok) {
    let message = `Anthropic API error (${res.status})`
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      /* non-JSON body */
    }
    if (res.status === 401) message = 'Invalid Anthropic API key.'
    throw new Error(message)
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  const review = parseReview(text, AI_MODEL)
  review.impactContext = impactContext
  return review
}
