import type { Dispatch } from 'react';
import type { StudioGraphNode, StudioLiveSnapshot } from '../../../contracts.js';
import type { StudioAction } from '../../../entities/studio/actions.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';

interface LiveGraphPanelProps {
  dispatch: Dispatch<StudioAction>;
  state: StudioDashboardState;
}

type Point = { x: number; y: number };

const kindOrder: StudioGraphNode['kind'][] = ['module', 'provider', 'controller', 'route', 'platform', 'external'];

function layoutNodes(nodes: StudioGraphNode[]): Map<string, Point> {
  const width = 960;
  const height = 420;
  const grouped = new Map<StudioGraphNode['kind'], StudioGraphNode[]>();
  for (const kind of kindOrder) {
    grouped.set(kind, []);
  }
  for (const node of nodes) {
    grouped.get(node.kind)?.push(node);
  }

  const positions = new Map<string, Point>();
  const visibleGroups = kindOrder.filter((kind) => (grouped.get(kind)?.length ?? 0) > 0);
  visibleGroups.forEach((kind, groupIndex) => {
    const group = grouped.get(kind) ?? [];
    const x = 80 + (groupIndex * (width - 160)) / Math.max(visibleGroups.length - 1, 1);
    group.forEach((node, index) => {
      const y = 70 + (index * (height - 140)) / Math.max(group.length - 1, 1);
      positions.set(node.id, { x, y });
    });
  });

  return positions;
}

function nodeTone(node: StudioGraphNode): string {
  if (node.status === 'error') return 'danger';
  if (node.status === 'warning') return 'warning';
  if (node.status === 'active') return 'active';
  return node.kind;
}

/**
 * Provides Live Graph Panel behavior for the Studio devtool.
 */
export function LiveGraphPanel({ dispatch, state }: LiveGraphPanelProps) {
  const snapshot = state.liveSnapshot;
  if (!snapshot) {
    return (
      <section className="card live-graph-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Live runtime graph</p>
            <h2>Modules, classes, and routes</h2>
          </div>
        </div>
        <EmptyState action="Start with fluo dev --studio and wait for the first runtime snapshot." title="No live snapshot yet." />
      </section>
    );
  }

  const positions = layoutNodes(snapshot.graph.nodes);
  const selectedNodeId = state.selectedGraphNodeId ?? snapshot.graph.nodes[0]?.id;
  const selectedNode = snapshot.graph.nodes.find((node) => node.id === selectedNodeId);
  const relatedNodeIds = new Set<string>();
  for (const edge of snapshot.graph.edges) {
    if (edge.from === selectedNodeId) relatedNodeIds.add(edge.to);
    if (edge.to === selectedNodeId) relatedNodeIds.add(edge.from);
  }

  return (
    <section className="card live-graph-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Live runtime graph</p>
          <h2>Modules, classes, and routes</h2>
        </div>
        <span className="mode-badge">{snapshot.graph.nodes.length} nodes · {snapshot.graph.edges.length} edges</span>
      </div>
      <div className="live-graph-layout">
        <div className="live-graph-canvas" aria-label="Runtime module/provider/controller/route graph">
          <svg viewBox="0 0 960 420" role="img">
            <defs>
              <marker id="live-arrow" markerHeight="7" markerWidth="10" orient="auto" refX="9" refY="3.5">
                <polygon className="live-edge-arrow" points="0 0, 10 3.5, 0 7" />
              </marker>
            </defs>
            {snapshot.graph.edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const highlighted = edge.from === selectedNodeId || edge.to === selectedNodeId;
              return (
                <g key={edge.id}>
                  <line className={`live-edge ${highlighted ? 'live-edge-highlighted' : ''}`} markerEnd="url(#live-arrow)" x1={from.x} x2={to.x} y1={from.y} y2={to.y} />
                  {highlighted ? <text className="live-edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}>{edge.label ?? edge.kind}</text> : null}
                </g>
              );
            })}
            {snapshot.graph.nodes.map((node) => {
              const point = positions.get(node.id);
              if (!point) return null;
              const selected = node.id === selectedNodeId;
              const related = relatedNodeIds.has(node.id);
              return (
                <g className={`live-node live-node-${nodeTone(node)} ${selected ? 'live-node-selected' : ''} ${related ? 'live-node-related' : ''}`} key={node.id} onClick={() => dispatch({ nodeId: node.id, type: 'select-graph-node' })} role="button" tabIndex={0}>
                  <rect height="46" rx="14" width="138" x={point.x - 69} y={point.y - 23} />
                  <text x={point.x} y={point.y - 2}>{node.label}</text>
                  <text className="live-node-kind" x={point.x} y={point.y + 14}>{node.kind}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="live-graph-details">
          <p className="eyebrow">Selected node</p>
          {selectedNode ? (
            <>
              <h3>{selectedNode.label}</h3>
              <div className="chips">
                <span className="chip">kind: {selectedNode.kind}</span>
                <span className="chip">id: {selectedNode.id}</span>
                {selectedNode.status ? <span className="chip">status: {selectedNode.status}</span> : null}
              </div>
              <h4>Explainable relationships</h4>
              <div className="edge-list">
                {snapshot.graph.edges
                  .filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
                  .map((edge) => (
                    <button className="edge-row" key={edge.id} onClick={() => dispatch({ nodeId: edge.from === selectedNode.id ? edge.to : edge.from, type: 'select-graph-node' })} type="button">
                      <strong>{edge.kind}</strong>
                      <span>{edge.from === selectedNode.id ? 'to' : 'from'} {edge.from === selectedNode.id ? edge.to : edge.from}</span>
                    </button>
                  ))}
              </div>
            </>
          ) : <p className="muted">No node selected.</p>}
        </aside>
      </div>
    </section>
  );
}
