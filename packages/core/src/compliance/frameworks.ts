/** Registry of selectable compliance baselines. A project picks one at
 * onboarding (persisted on its repo row); the scanner keys off it here and
 * the server selects the matching AI review prompt by the same id. */

import type { ComplianceCategory, ComplianceFramework } from '../types'
import { OWASP_CATEGORIES, OWASP_RULES } from './owasp'
import { MISRA_C_CATEGORIES, MISRA_C_RULES } from './misra'

export const FRAMEWORK_OWASP = 'owasp-top-10-2021'
export const FRAMEWORK_MISRA = 'misra-c-2012'

const OWASP_FRAMEWORK: ComplianceFramework = {
  id: FRAMEWORK_OWASP,
  name: 'OWASP Top 10 (2021)',
  shortName: 'OWASP Top 10',
  categories: OWASP_CATEGORIES,
  rules: OWASP_RULES,
  // '#' starts a comment in the scripting languages this baseline scans.
  commentLinePattern: /^(?:\/\/|#|\*|\/\*|<!--)/,
  // No fileFilter: the broad polyglot default applies.
}

const MISRA_FRAMEWORK: ComplianceFramework = {
  id: FRAMEWORK_MISRA,
  name: 'MISRA C:2012',
  shortName: 'MISRA C:2012',
  categories: MISRA_C_CATEGORIES,
  rules: MISRA_C_RULES,
  // '#' must NOT be skipped as a comment: preprocessor lines (#include,
  // #define, #undef) are exactly what several MISRA rules target.
  commentLinePattern: /^(?:\/\/|\/\*|\*)/,
  fileFilter: /\.(?:c|h|inl)$/i,
}

export const FRAMEWORKS: ComplianceFramework[] = [OWASP_FRAMEWORK, MISRA_FRAMEWORK]

/** Look up a framework by persisted id; unknown ids fall back to OWASP so
 * older rows (written before frameworks existed) keep working. */
export function frameworkById(id: string | null | undefined): ComplianceFramework {
  return FRAMEWORKS.find((f) => f.id === id) ?? OWASP_FRAMEWORK
}

/** Category lookup across every framework; ids are globally unique
 * (A01…A10 for OWASP, M1…M22 and MDIR for MISRA C). */
export function categoryById(id: string): ComplianceCategory | undefined {
  for (const framework of FRAMEWORKS) {
    const category = framework.categories.find((c) => c.id === id)
    if (category) return category
  }
  return undefined
}
