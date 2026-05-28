import type { StudioDashboardState } from '../../../entities/studio/model.js';

const statusLabel: Record<StudioDashboardState['connection']['status'], string> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'disconnected',
  error: 'error',
  reconnecting: 'reconnecting',
  restarting: 'restarting',
  stale: 'stale',
  static: 'static',
};

/**
 * Provides Connection Status Widget behavior for the Studio devtool.
 */
export function ConnectionStatusWidget({ state }: { state: StudioDashboardState }) {
  const snapshot = state.liveSnapshot;
  const counts = snapshot
    ? [
        ['nodes', snapshot.graph.nodes.length],
        ['edges', snapshot.graph.edges.length],
        ['routes', snapshot.routes.length],
        ['requests', snapshot.requests.length],
        ['diagnostics', snapshot.diagnostics.length],
      ] as const
    : [];

  return (
    <div className={`card live-connection connection-${state.connection.status}`}>
      <div className="live-status-main">
        <div>
          <p className="eyebrow">Runtime-connected Studio</p>
          <h2>Live devtool bridge</h2>
          <p>{state.connection.message ?? 'Waiting for the local Studio sidecar.'}</p>
        </div>
        <div className="connection-orb-wrap" aria-label={`Studio connection ${statusLabel[state.connection.status]}`}>
          <span className="connection-orb" />
          <strong>{statusLabel[state.connection.status]}</strong>
        </div>
      </div>
      <div className="chips">
        <span className="chip">mode: {state.mode}</span>
        {state.appId ? <span className="chip">app: {state.appId}</span> : null}
        {state.epoch ? <span className="chip">epoch: {state.epoch}</span> : null}
        {state.connection.lastEventAt ? <span className="chip">last event: {state.connection.lastEventAt}</span> : null}
        {counts.map(([label, count]) => <span className="chip" key={label}>{label}: {count}</span>)}
      </div>
    </div>
  );
}
