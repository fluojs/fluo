import type { Dispatch } from 'react';
import type { StudioRouteDescriptor } from '../../../contracts.js';
import type { StudioAction } from '../../../entities/studio/actions.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectSelectedRoute } from '../../../entities/studio/model.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';

interface RoutesPanelProps {
  dispatch: Dispatch<StudioAction>;
  state: StudioDashboardState;
}

function routeGraphNodeId(route: StudioRouteDescriptor, state: StudioDashboardState): string | undefined {
  return state.liveSnapshot?.graph.nodes.find((node) => node.kind === 'route' && node.label === `${route.method} ${route.path}`)?.id;
}

/**
 * Provides Routes Panel behavior for the Studio devtool.
 */
export function RoutesPanel({ dispatch, state }: RoutesPanelProps) {
  const routes = state.liveSnapshot?.routes ?? [];
  const selectedRoute = selectSelectedRoute(state);

  return (
    <section className="card routes-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">HTTP routes</p>
          <h2>Routes</h2>
        </div>
        <span className="mode-badge">{routes.length} routes</span>
      </div>
      {routes.length === 0 ? <EmptyState action="Runtime route descriptors will appear after bootstrap." title="No live routes yet." /> : (
        <div className="routes-layout">
          <div className="route-list">
            {routes.map((route) => {
              const selected = route.id === selectedRoute?.id;
              return (
                <button className={`route-row ${selected ? 'route-row-selected' : ''}`} key={route.id} onClick={() => {
                  dispatch({ routeId: route.id, type: 'select-route' });
                  const graphNodeId = routeGraphNodeId(route, state);
                  if (graphNodeId) dispatch({ nodeId: graphNodeId, type: 'select-graph-node' });
                }} type="button">
                  <span className={`method method-${route.method.toLowerCase()}`}>{route.method}</span>
                  <strong>{route.path}</strong>
                  <small>{route.module ?? 'unknown module'} · {route.controller}.{route.handler}</small>
                </button>
              );
            })}
          </div>
          <aside className="route-detail">
            <p className="eyebrow">Selected route</p>
            {selectedRoute ? (
              <>
                <h3>{selectedRoute.method} {selectedRoute.path}</h3>
                <div className="chips">
                  <span className="chip">controller: {selectedRoute.controller}</span>
                  <span className="chip">handler: {selectedRoute.handler}</span>
                  {selectedRoute.module ? <span className="chip">module: {selectedRoute.module}</span> : null}
                  {selectedRoute.version ? <span className="chip">version: {selectedRoute.version}</span> : null}
                </div>
              </>
            ) : <p className="muted">Select a route to inspect handler correlation.</p>}
          </aside>
        </div>
      )}
    </section>
  );
}
