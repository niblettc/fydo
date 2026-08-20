import { frameworkById } from '@fydo/core'
import type { UnifiedFinding } from '@fydo/core'

interface Props {
  /** Unresolved (open or needs-review) findings across unique analyzed commits */
  openFindings: UnifiedFinding[]
  /** Compliance framework id the project is checked against */
  framework: string
}

export function BaselinePanel({ openFindings, framework }: Props) {
  const fw = frameworkById(framework)
  const listed = new Set(fw.categories.map((c) => c.id))
  const findingCounts = new Map<string, number>()
  // Includes findings whose category isn't a panel row (e.g. an AI-cited
  // MISRA section with no scanner rules), so nothing silently disappears.
  let uncategorized = 0
  for (const f of openFindings) {
    if (f.owaspId && listed.has(f.owaspId)) {
      findingCounts.set(f.owaspId, (findingCounts.get(f.owaspId) ?? 0) + 1)
    } else {
      uncategorized++
    }
  }

  // MISRA lists every section but the scanner only covers some; hide sections
  // with neither scanner rules nor active findings so the panel stays scannable.
  // OWASP is unaffected (every category has rules).
  const visible = fw.categories.filter(
    (cat) =>
      (findingCounts.get(cat.id) ?? 0) > 0 || fw.rules.some((r) => r.owaspId === cat.id),
  )

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Baseline: {fw.name}</h2>
        <span className="badge neutral">{fw.rules.length} rules</span>
      </div>
      <ul className="baseline-list">
        {visible.map((cat) => {
          const ruleCount = fw.rules.filter((r) => r.owaspId === cat.id).length
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
                <span className="muted small-text">
                  {ruleCount > 0 ? `${ruleCount} rules` : 'AI only'}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      {uncategorized > 0 && (
        <p className="muted small-text">
          {uncategorized} unresolved finding{uncategorized === 1 ? '' : 's'} without a baseline
          category.
        </p>
      )}
    </section>
  )
}
