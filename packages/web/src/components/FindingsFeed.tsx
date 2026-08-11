import { useState } from 'react'
import { findingMatchesFilters } from '../findings'
import type { FindingFeedItem, SeverityFilter, StatusFilter } from '../findings'
import { FindingCard } from './FindingCard'
import type { TriageFn } from './FindingCard'

export type { SeverityFilter, StatusFilter } from '../findings'

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Active (open + needs review)' },
  { value: 'open', label: 'Requires action' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'closed', label: 'Dismissed & resolved' },
  { value: 'all', label: 'All statuses' },
]

const SEVERITY_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: 'all', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

function matchesSearch(item: FindingFeedItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const { finding, commit } = item
  return (
    finding.title.toLowerCase().includes(q) ||
    finding.description.toLowerCase().includes(q) ||
    (finding.file?.toLowerCase().includes(q) ?? false) ||
    commit.message.toLowerCase().includes(q) ||
    commit.sha.startsWith(q)
  )
}

interface Props {
  items: FindingFeedItem[]
  hasBranches: boolean
  statusFilter: StatusFilter
  severityFilter: SeverityFilter
  onStatusFilterChange: (f: StatusFilter) => void
  onSeverityFilterChange: (f: SeverityFilter) => void
  onTriage: TriageFn
}

export function FindingsFeed({
  items,
  hasBranches,
  statusFilter,
  severityFilter,
  onStatusFilterChange,
  onSeverityFilterChange,
  onTriage,
}: Props) {
  const [query, setQuery] = useState('')

  const visible = items.filter(
    (item) =>
      findingMatchesFilters(item.finding, statusFilter, severityFilter) &&
      matchesSearch(item, query.trim()),
  )

  return (
    <section className="panel feed">
      <div className="panel-header">
        <h2>Findings</h2>
        <span className="muted small-text">
          {visible.length} of {items.length} shown
        </span>
      </div>

      <div className="findings-filters">
        <select
          className="inline-select"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="inline-select"
          value={severityFilter}
          onChange={(e) => onSeverityFilterChange(e.target.value as SeverityFilter)}
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="findings-search"
          type="search"
          placeholder="Search title, file, commit…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!hasBranches && (
        <p className="muted empty-row">Select one or more branches to start monitoring.</p>
      )}
      {hasBranches && items.length === 0 && (
        <p className="muted empty-row">No findings yet — analyzed commits are clean.</p>
      )}
      {hasBranches && items.length > 0 && visible.length === 0 && (
        <p className="muted empty-row">No findings match the current filters.</p>
      )}

      <div className="findings findings-feed-list">
        {visible.map((item) => (
          <FindingCard
            key={item.finding.id}
            finding={item.finding}
            sha={item.commit.sha}
            onTriage={onTriage}
            context={{ commit: item.commit, branches: item.branches }}
          />
        ))}
      </div>
    </section>
  )
}
