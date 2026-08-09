interface Props {
  onBack: () => void
  onContinue: () => void
}

export function FrameworkStep({ onBack, onContinue }: Props) {
  return (
    <>
      <div className="framework-options">
        <button type="button" className="framework-card selected" aria-pressed="true">
          <div className="framework-card-head">
            <strong>OWASP Top 10 (2021)</strong>
            <span className="badge pass small">selected</span>
          </div>
          <p className="muted small-text">
            Every commit is checked against pattern rules mapped to the ten OWASP Top 10
            categories — injection, broken access control, cryptographic failures, and more —
            then triaged by AI.
          </p>
        </button>

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
