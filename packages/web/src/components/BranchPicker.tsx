import { useMemo, useState } from 'react'
import type { BranchInfo } from '@fydo/core'

interface Props {
  branches: BranchInfo[]
  selected: string[]
  defaultBranch: string
  onChange: (selected: string[]) => void
}

export function BranchPicker({ branches, selected, defaultBranch, onChange }: Props) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches
    return [...list].sort((a, b) => {
      if (a.name === defaultBranch) return -1
      if (b.name === defaultBranch) return 1
      return a.name.localeCompare(b.name)
    })
  }, [branches, filter, defaultBranch])

  function toggle(name: string) {
    onChange(
      selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name],
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Monitored branches</h2>
        <span className="badge neutral">{selected.length} selected</span>
      </div>
      <input
        className="filter-input"
        type="text"
        placeholder="Filter branches…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="branch-list">
        {filtered.map((b) => (
          <li key={b.name}>
            <label className="branch-row">
              <input
                type="checkbox"
                checked={selected.includes(b.name)}
                onChange={() => toggle(b.name)}
              />
              <span className="branch-name">{b.name}</span>
              {b.name === defaultBranch && <span className="badge neutral small">default</span>}
              {b.protected && <span className="badge neutral small">protected</span>}
            </label>
          </li>
        ))}
        {filtered.length === 0 && <li className="muted empty-row">No branches match.</li>}
      </ul>
    </section>
  )
}
