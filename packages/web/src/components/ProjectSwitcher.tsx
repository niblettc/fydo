import { useEffect, useRef, useState } from 'react'
import type { RepoRow } from '../db'

interface Props {
  /** Onboarded projects for this account */
  projects: RepoRow[]
  activeId: string | null
  activeName: string
  /** True while another project is being opened */
  switching: boolean
  onSelect: (project: RepoRow) => void
  onNewProject: () => void
}

export function ProjectSwitcher({
  projects,
  activeId,
  activeName,
  switching,
  onSelect,
  onNewProject,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="project-switcher" ref={rootRef}>
      <button
        type="button"
        className="project-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={switching}
      >
        <span className="project-trigger-name">{switching ? 'Opening…' : activeName}</span>
        <span className="chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="project-menu" role="menu">
          <div className="project-menu-heading">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className={`project-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => {
                setOpen(false)
                if (p.id !== activeId) onSelect(p)
              }}
            >
              <span className="project-item-name">{p.fullName}</span>
              {p.id === activeId && <span className="project-check">✓</span>}
            </button>
          ))}
          <div className="project-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="project-item project-item-new"
            onClick={() => {
              setOpen(false)
              onNewProject()
            }}
          >
            + New project
          </button>
        </div>
      )}
    </div>
  )
}
