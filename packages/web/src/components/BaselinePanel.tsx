import { OWASP_CATEGORIES, OWASP_RULES } from '@fydo/core'
import type { UnifiedFinding } from '@fydo/core'

interface Props {
  /** Unresolved (open or needs-review) findings across unique analyzed commits */
  openFindings: UnifiedFinding[]
}

export function BaselinePanel({ openFindings }: Props) {
  const findingCounts = new Map<string, number>()
  let uncategorized = 0
  for (const f of openFindings) {
    if (f.owaspId) {
      findingCounts.set(f.owaspId, (findingCounts.get(f.owaspId) ?? 0) + 1)
    } else {
      uncategorized++
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Baseline: OWASP Top 10 (2021)</h2>
        <span className="badge neutral">{OWASP_RULES.length} rules</span>
      </div>
      <ul className="baseline-list">
        {OWASP_CATEGORIES.map((cat) => {
          const ruleCount = OWASP_RULES.filter((r) => r.owaspId === cat.id).length
          const hits = findingCounts.get(cat.id) ?? 0
          return (
            <li key={cat.id} className={hits > 0 ? 'baseline-hit' : ''} title={cat.description}>
              <span className="baseline-code">{cat.code}</span>
              <span className="baseline-name">{cat.name}</span>
              <span className="baseline-counts">
                {hits > 0 ? (
                  <span className="badge sev-high">{hits}</span>
                ) : (
                  <span className="badge pass">✓</span>
                )}
                <span className="muted small-text">{ruleCount} rules</span>
              </span>
            </li>
          )
        })}
      </ul>
      {uncategorized > 0 && (
        <p className="muted small-text">
          {uncategorized} unresolved finding{uncategorized === 1 ? '' : 's'} without an OWASP
          category.
        </p>
      )}
    </section>
  )
}
