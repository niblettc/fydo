import type { ReactNode } from 'react'

const STEPS = ['Repository', 'Framework', 'Branches', 'Prepare'] as const

interface Props {
  /** 1-based index into the wizard steps */
  step: 1 | 2 | 3 | 4
  title: string
  subtitle?: string
  children: ReactNode
  onSignOut?: () => void
  /** Abandon the wizard and return to the active project's dashboard */
  onCancel?: () => void
}

export function WizardShell({ step, title, subtitle, children, onSignOut, onCancel }: Props) {
  return (
    <div className="connect-wrap">
      <div className="connect-card wizard-card">
        <div className="wizard-top">
          <span className="connect-logo">⬢</span>
          <span className="wizard-top-actions">
            {onCancel && (
              <button type="button" className="btn subtle" onClick={onCancel}>
                Back to dashboard
              </button>
            )}
            {onSignOut && (
              <button type="button" className="btn subtle" onClick={onSignOut}>
                Sign out
              </button>
            )}
          </span>
        </div>

        <ol className="wizard-steps">
          {STEPS.map((label, i) => {
            const n = i + 1
            const state = n < step ? 'done' : n === step ? 'active' : 'todo'
            return (
              <li key={label} className={`wizard-step ${state}`}>
                <span className="wizard-step-dot">{n < step ? '✓' : n}</span>
                <span className="wizard-step-label">{label}</span>
              </li>
            )
          })}
        </ol>

        <h1>{title}</h1>
        {subtitle && <p className="connect-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}
