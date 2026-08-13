import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { blobUrl } from '@fydo/core'
import type { RepoInfo } from '@fydo/core'
import { fetchImpactGraph } from '../backend'
import type { ImpactGraph, ImpactGraphNode } from '../backend'

interface Props {
  repo: RepoInfo
  /** Commit sha, used to pin code links to this commit's file versions */
  sha: string
  /** Repo-relative paths the commit changed */
  paths: string[]
}

type FileNode = Node<{ file: ImpactGraphNode }, 'file'>

function FileNodeView({ data }: NodeProps<FileNode>) {
  const { file } = data
  const slash = file.path.lastIndexOf('/')
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
  const base = slash >= 0 ? file.path.slice(slash + 1) : file.path
  return (
    <div
      className={`impact-node ${file.changed ? 'impact-node-changed' : ''} ${
        file.severity ? `impact-node-sev-${file.severity}` : ''
      }`}
      title={`${file.path} — click to view the file`}
    >
      <Handle type="target" position={Position.Left} className="impact-handle" />
      <div className="impact-node-name">{base}</div>
      {dir && <div className="impact-node-dir">{dir}</div>}
      <div className="impact-node-meta">
        {file.changed && <span className="impact-chip impact-chip-changed">changed</span>}
        {file.severity && (
          <span className={`impact-chip impact-chip-sev-${file.severity}`}>{file.severity}</span>
        )}
        {file.component && <span className="impact-chip">{file.component}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="impact-handle" />
    </div>
  )
}

const nodeTypes = { file: FileNodeView }

const COL_WIDTH = 300
const ROW_HEIGHT = 92

/** Layered layout: column = import distance from the change (0 = changed
 * file), rows centered vertically per column. */
function buildFlow(graph: ImpactGraph): { nodes: FileNode[]; edges: Edge[] } {
  const columns = new Map<number, ImpactGraphNode[]>()
  for (const n of graph.nodes) {
    const col = Math.min(n.distance, 3)
    const list = columns.get(col) ?? []
    list.push(n)
    columns.set(col, list)
  }
  const maxRows = Math.max(...[...columns.values()].map((c) => c.length))

  const nodes: FileNode[] = []
  for (const [col, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((file, row) => {
      nodes.push({
        id: file.path,
        type: 'file',
        position: {
          x: col * COL_WIDTH,
          y: row * ROW_HEIGHT + ((maxRows - list.length) * ROW_HEIGHT) / 2,
        },
        data: { file },
      })
    })
  }

  const known = new Set(nodes.map((n) => n.id))
  // The graph stores "a imports b"; impact flows the other way (b breaks a),
  // so arrows point from the imported file toward its dependent.
  const edges: Edge[] = graph.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e, i) => ({
      id: `e${i}`,
      source: e.target,
      target: e.source,
      className: 'impact-edge',
      markerEnd: { type: MarkerType.ArrowClosed },
    }))

  return { nodes, edges }
}

export function ImpactMap({ repo, sha, paths }: Props) {
  const [open, setOpen] = useState(false)
  const [graph, setGraph] = useState<ImpactGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lazy: only hit the graph backend once the section is opened.
  useEffect(() => {
    if (!open || graph || loading || error) return
    setLoading(true)
    fetchImpactGraph(repo.provider, repo.fullName, paths)
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [open, graph, loading, error, repo, paths])

  const flow = useMemo(() => (graph ? buildFlow(graph) : null), [graph])

  const stats = useMemo(() => {
    if (!graph) return null
    const direct = graph.nodes.filter((n) => !n.changed && n.distance === 1).length
    const transitive = graph.nodes.filter((n) => !n.changed && n.distance > 1).length
    const components = [...new Set(graph.nodes.map((n) => n.component).filter(Boolean))]
    return { changed: paths.length, direct, transitive, components }
  }, [graph, paths.length])

  if (paths.length === 0) return null

  return (
    <div className="impact-map-section">
      <div className="ai-section-head">
        <h3 className="evidence-heading">Impact map</h3>
        {stats && (
          <span className="muted small-text">
            {stats.changed} changed · {stats.direct} direct · {stats.transitive} transitive
            {stats.components.length > 0 && ` · ${stats.components.join(', ')}`}
            {graph?.truncated ? ' · truncated' : ''}
          </span>
        )}
        <button className="btn small-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && loading && (
        <p className="muted small-text">Loading dependency subgraph…</p>
      )}
      {open && error && (
        <p className="muted small-text">
          Impact map unavailable — {error}{' '}
          <button className="btn small-btn" onClick={() => setError(null)}>
            Retry
          </button>
        </p>
      )}
      {open && flow && stats && stats.direct + stats.transitive === 0 && (
        <p className="muted small-text">
          No known dependents — the changed files are leaf modules in the dependency graph.
        </p>
      )}
      {open && flow && (
        <div className="impact-map">
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.15}
            nodesConnectable={false}
            deleteKeyCode={null}
            colorMode="dark"
            onNodeClick={(_, node) =>
              window.open(
                blobUrl(repo.provider, repo.htmlUrl, sha, node.id),
                '_blank',
                'noreferrer',
              )
            }
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </div>
  )
}
