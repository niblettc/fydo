import { FRAMEWORK_MISRA, FRAMEWORK_OWASP } from '@fydo/core'

interface Props {
  framework: string
  onChange: (framework: string) => void
  onBack: () => void
  onContinue: () => void
}

const OPTIONS = [
  {
    id: FRAMEWORK_OWASP,
    name: 'OWASP Top 10 (2021)',
    blurb:
      'Every commit is checked against pattern rules mapped to the ten OWASP Top 10 categories — injection, broken access control, cryptographic failures, and more — then triaged by AI.',
  },
  {
    id: FRAMEWORK_MISRA,
    name: 'MISRA C:2012',
    blurb:
      'Commits touching C sources and headers are checked against rules for the decidable MISRA C:2012 guidelines — banned library facilities, preprocessor misuse, control-flow restrictions — then AI-reviewed against the full guideline set with rule citations.',
  },
]

export function FrameworkStep({ framework, onChange, onBack, onContinue }: Props) {
  return (
    <>
      <div className="framework-options">
        {OPTIONS.map((option) => {
          const selected = framework === option.id
          return (
            <button
              key={option.id}
              type="button"
              className={`framework-card ${selected ? 'selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
            >
              <div className="framework-card-head">
                <strong>{option.name}</strong>
                {selected && <span className="badge pass small">selected</span>}
              </div>
              <p className="muted small-text">{option.blurb}</p>
            </button>
          )
        })}

        <div className="framework-card disabled" aria-disabled="true">
          <div className="framework-card-head">
            <strong>More frameworks</strong>
            <span className="badge neutral small">coming soon</span>
          </div>
          <p className="muted small-text">
            CIS Benchmarks, SOC 2 and PCI DSS control mappings are on the roadmap.
          </p>
        </div>
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn subtle" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  )
}
