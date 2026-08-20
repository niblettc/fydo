/** Server-side AI review: builds the prompt, calls Anthropic with the
 * server's key, and parses the structured verdict response. */

import type { AiAdditionalFinding, AiFindingVerdict, AiReview, AnalysisReport } from '@fydo/core'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
export const AI_MODEL = 'claude-sonnet-4-5'

/** Keep the request well under context limits regardless of commit size */
const MAX_TOTAL_PATCH_CHARS = 24_000
const MAX_FILES = 12

/** Per-framework prompt and category-schema configuration. The framework id
 * comes from the client (persisted per repo); unknown ids fall back to OWASP. */
interface FrameworkPromptConfig {
  system: string
  /** Description for the `category` field in the tool schema */
  categoryDescription: string
  /** JSON-schema pattern enforced on the `category` field */
  categoryPattern: string
  /** Maps a schema-valid category reference to a stored category id
   * (e.g. "Rule 21.3" → "M21"); undefined discards the reference (the title
   * keeps it when keepReferenceInTitle is set). */
  normalizeCategory: (raw: string) => string | undefined
  /** Prefixed onto additional-finding titles so the guideline reference
   * survives category normalization (MISRA only). */
  keepReferenceInTitle: boolean
}

const SHARED_RULES = `Submit your review by calling the submit_security_review tool. Rules:
- Provide exactly one verdict per scanner finding.
- Assign a risk category (severity: low, medium, high, or critical) to every additional finding, and an overall_risk category to the commit as a whole. You assign risk categories only — whether a finding is flagged "needs review" or "requires action" is decided by the system from your verdicts and findings, not by you.
- Never raise an issue only in the summary. Anything worth mentioning must be itemized as a verdict or an additional finding; the summary is a narrative recap of what you itemized.
- An overall_risk of medium or higher must be justified by at least one confirmed verdict or additional finding.
- If there are no scanner findings, return an empty verdicts array and focus on additional_findings.`

const OWASP_CONFIG: FrameworkPromptConfig = {
  system: `You are an expert application-security reviewer triaging automated OWASP Top 10 scanner findings on a git commit.

The findings come from simple regex-based rules, so false positives are common (test fixtures, example code, already-sanitized values, dead code). Judge each finding in the context of the diff provided.

${SHARED_RULES}
- Report every concrete security issue you see in the diff that the scanner missed as an entry in additional_findings. Each must be a discrete, actionable issue — not a general observation — with a file and line where identifiable.`,
  categoryDescription: "OWASP Top 10 (2021) category id (e.g. 'A03') if one clearly applies",
  categoryPattern: '^A(0[1-9]|10)$',
  normalizeCategory: (raw) => (/^A(0[1-9]|10)$/.test(raw) ? raw : undefined),
  keepReferenceInTitle: false,
}

const MISRA_CONFIG: FrameworkPromptConfig = {
  system: `You are an expert embedded-C reviewer triaging automated MISRA C:2012 scanner findings on a git commit.

The scanner findings come from simple regex-based rules that cover only the small, decidable subset of the guidelines, so false positives are common (matches inside string literals or macros, code that is compliant in context, non-production scaffolding). Judge each finding in the context of the diff provided.

${SHARED_RULES}
- Report every clear MISRA C:2012 guideline violation you can see in the added lines that the scanner missed as an entry in additional_findings — especially essential-type-model, side-effect, control-flow, pointer, switch, and initialization rules that regexes cannot decide. Each must be a discrete, actionable violation with a file and line where identifiable, citing the guideline reference in the category field.
- Map severity from the guideline classification where you know it: mandatory → critical, required → high, advisory → medium or low.
- Only review C source and header files; give non-C files in the diff no verdicts beyond those required for scanner findings.`,
  categoryDescription:
    "MISRA C:2012 guideline reference for the violation, e.g. 'Rule 21.3' or 'Dir 4.6'",
  categoryPattern: '^(Rule|Dir) \\d+\\.\\d+$',
  normalizeCategory: (raw) => {
    // Section ids match MISRA_C_CATEGORIES ("M7", "M21"). Directives have no
    // section category; their reference stays in the finding title.
    const m = /^Rule\s+(\d+)\.\d+$/i.exec(raw)
    return m ? `M${Number(m[1])}` : undefined
  },
  keepReferenceInTitle: true,
}

const FRAMEWORK_MISRA_ID = 'misra-c-2012'

function promptConfig(framework?: string): FrameworkPromptConfig {
  return framework === FRAMEWORK_MISRA_ID ? MISRA_CONFIG : OWASP_CONFIG
}

/** Forced tool call: the API enforces this schema, so findings can't hide in
 * prose and enums can't drift (e.g. "Critical" vs "critical"). */
function buildReviewTool(fw: FrameworkPromptConfig) {
  return {
    name: 'submit_security_review',
    description:
      'Record the structured compliance review for this commit. Call exactly once with the complete review.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: "2-3 sentence overall assessment of this commit's compliance posture",
        },
        overall_risk: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description:
            'Your risk category for the commit as a whole, justified by the verdicts and findings you record',
        },
        verdicts: {
          type: 'array',
          description: 'Exactly one verdict per scanner finding',
          items: {
            type: 'object',
            properties: {
              finding_index: {
                type: 'integer',
                description: 'Index of the scanner finding being judged',
              },
              verdict: { type: 'string', enum: ['confirmed', 'false-positive', 'uncertain'] },
              explanation: {
                type: 'string',
                description: '1-3 sentences: why, referencing the specific code',
              },
              suggested_action: {
                type: 'string',
                description: 'Concrete next step for the developer',
              },
            },
            required: ['finding_index', 'verdict', 'explanation'],
          },
        },
        additional_findings: {
          type: 'array',
          description: 'Discrete, actionable violations in the diff that the scanner missed',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short issue title' },
              severity: {
                type: 'string',
                enum: ['critical', 'high', 'medium', 'low'],
                description: 'Risk category for this finding',
              },
              category: {
                type: 'string',
                pattern: fw.categoryPattern,
                description: fw.categoryDescription,
              },
              file: {
                type: 'string',
                description: 'Path of the affected file from the diff, if identifiable',
              },
              line: {
                type: 'integer',
                description: 'Line in the new file, if identifiable',
              },
              explanation: {
                type: 'string',
                description: '1-3 sentences: what the issue is and why it matters',
              },
              suggested_action: {
                type: 'string',
                description: 'Concrete next step for the developer',
              },
            },
            required: ['title', 'severity', 'explanation'],
          },
        },
      },
      required: ['summary', 'overall_risk', 'verdicts', 'additional_findings'],
    },
  } as const
}

export interface ReviewCommitInput {
  message: string
  branch: string
}

function buildUserPrompt(
  commit: ReviewCommitInput,
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

interface RawAdditionalFinding {
  title?: string
  severity?: string
  category?: string
  file?: string
  line?: number
  explanation?: string
  suggested_action?: string
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : ''
}

/** Defensive normalizer over the forced tool-call input. The API already
 * enforces the schema; this maps snake_case to our types and tolerates
 * casing drift without silently downgrading valid severities. */
function parseReview(input: unknown, model: string, fw: FrameworkPromptConfig): AiReview {
  const raw = (input ?? {}) as {
    summary?: string
    overall_risk?: string
    verdicts?: RawVerdict[]
    additional_findings?: RawAdditionalFinding[]
  }

  const validVerdicts: AiFindingVerdict[] = (raw.verdicts ?? [])
    .filter(
      (v): v is Required<Pick<RawVerdict, 'finding_index' | 'explanation'>> & RawVerdict =>
        typeof v?.finding_index === 'number' &&
        typeof v.explanation === 'string' &&
        ['confirmed', 'false-positive', 'uncertain'].includes(lower(v.verdict)),
    )
    .map((v) => ({
      findingIndex: v.finding_index,
      verdict: lower(v.verdict) as AiFindingVerdict['verdict'],
      explanation: v.explanation,
      suggestedAction: v.suggested_action,
    }))

  const risk = (SEVERITIES as readonly string[]).includes(lower(raw.overall_risk))
    ? (lower(raw.overall_risk) as AiReview['overallRisk'])
    : 'low'

  const additionalFindings: AiAdditionalFinding[] = (raw.additional_findings ?? [])
    .filter(
      (f): f is RawAdditionalFinding & { title: string; explanation: string } =>
        typeof f?.title === 'string' &&
        f.title.length > 0 &&
        typeof f.explanation === 'string' &&
        f.explanation.length > 0 &&
        (SEVERITIES as readonly string[]).includes(lower(f.severity)),
    )
    .map((f) => {
      const reference = typeof f.category === 'string' ? f.category.trim() : ''
      // Category ids are section-level; keep the exact guideline reference
      // visible in the title (e.g. "Rule 10.3: implicit narrowing conversion").
      const title =
        fw.keepReferenceInTitle && reference && !f.title.includes(reference)
          ? `${reference}: ${f.title}`
          : f.title
      return {
        title,
        severity: lower(f.severity) as AiAdditionalFinding['severity'],
        owaspId: reference ? fw.normalizeCategory(reference) : undefined,
        file: typeof f.file === 'string' && f.file ? f.file : undefined,
        line: typeof f.line === 'number' ? f.line : undefined,
        explanation: f.explanation,
        suggestedAction: f.suggested_action,
      }
    })

  return {
    summary: raw.summary ?? 'No summary provided.',
    overallRisk: risk,
    verdicts: validVerdicts,
    additionalFindings,
    model,
    reviewedAt: new Date().toISOString(),
  }
}

export async function reviewCommit(
  apiKey: string,
  commit: ReviewCommitInput,
  report: AnalysisReport,
  impactContext?: string,
  framework?: string,
): Promise<AiReview> {
  const fw = promptConfig(framework)
  const tool = buildReviewTool(fw)
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      system: fw.system,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildUserPrompt(commit, report, impactContext) }],
    }),
  })

  if (!res.ok) {
    let message = `Anthropic API error (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch {
      /* non-JSON body */
    }
    if (res.status === 401) message = 'Invalid Anthropic API key on the server.'
    throw new Error(message)
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; name?: string; input?: unknown }>
  }
  const toolUse = data.content.find((b) => b.type === 'tool_use' && b.name === tool.name)
  if (!toolUse) throw new Error('AI response did not include the structured review tool call.')
  const review = parseReview(toolUse.input, AI_MODEL, fw)
  review.impactContext = impactContext
  return review
}
