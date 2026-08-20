import { BranchPicker } from '../components/BranchPicker'
import type { BranchInfo } from '@fydo/core'

interface Props {
  branches: BranchInfo[]
  selected: string[]
  defaultBranch: string
  onChange: (selected: string[]) => void
  /** Raw directory-scope input; normalized when the preparation starts */
  scanDir: string
  onScanDirChange: (value: string) => void
  onBack: () => void
  onContinue: () => void
}

export function BranchesStep({
  branches,
  selected,
  defaultBranch,
  onChange,
  scanDir,
  onScanDirChange,
  onBack,
  onContinue,
}: Props) {
  return (
    <>
      <BranchPicker
        branches={branches}
        selected={selected}
        defaultBranch={defaultBranch}
        onChange={onChange}
      />
      <p className="hint">
        The five most recent commits on each selected branch are analyzed and AI-reviewed during
        setup, so each extra branch adds a little preparation time.
      </p>

      <div className="connect-section">
        <label>
          Limit scanning to a directory (optional)
          <input
            type="text"
            className="mono"
            placeholder="e.g. packages/api — leave blank to scan the whole repository"
            value={scanDir}
            onChange={(e) => onScanDirChange(e.target.value)}
          />
        </label>
        <p className="hint">
          Useful for monorepos with multiple products: only commits touching this directory are
          analyzed, and the dependency graph is built from it alone.
        </p>
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn subtle" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={onContinue}
          disabled={selected.length === 0}
        >
          {selected.length === 0
            ? 'Select at least one branch'
            : `Prepare ${selected.length} branch${selected.length === 1 ? '' : 'es'}`}
        </button>
      </div>
    </>
  )
}
