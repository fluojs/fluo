import type { Dispatch } from 'react';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectSelectedRequest } from '../../../entities/studio/model.js';
import type { StudioAction } from '../../../features/live-connection/model/reducer.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';

interface RequestFlowPanelProps {
  dispatch: Dispatch<StudioAction>;
  state: StudioDashboardState;
}

function statusTone(status: string): string {
  if (status === 'failed') return 'danger';
  if (status === 'succeeded') return 'success';
  if (status === 'matched') return 'accent';
  return 'muted';
}

/**
 * Provides Request Flow Panel behavior for the Studio devtool.
 */
export function RequestFlowPanel({ dispatch, state }: RequestFlowPanelProps) {
  const requests = state.liveSnapshot?.requests ?? [];
  const selectedRequest = selectSelectedRequest(state);

  return (
    <section className="card request-flow-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Recent runtime traffic</p>
          <h2>Request flow</h2>
        </div>
        <span className="mode-badge">bounded retention · no request bodies</span>
      </div>
      {requests.length === 0 ? <EmptyState action="Send requests to the running app to see route/handler-level traces." title="No live requests yet." /> : (
        <div className="request-layout">
          <div className="request-timeline">
            {requests.map((request) => (
              <button className={`request-row request-row-${statusTone(request.status)} ${request.requestId === selectedRequest?.requestId ? 'request-row-selected' : ''}`} key={request.requestId} onClick={() => dispatch({ requestId: request.requestId, type: 'select-request' })} type="button">
                <span>{request.method}</span>
                <strong>{request.path}</strong>
                <small>{request.status}{request.statusCode ? ` · ${String(request.statusCode)}` : ''}{request.durationMs !== undefined ? ` · ${request.durationMs.toFixed(2)}ms` : ''}</small>
              </button>
            ))}
          </div>
          <aside className="request-detail">
            <p className="eyebrow">Selected request</p>
            {selectedRequest ? (
              <>
                <h3>{selectedRequest.method} {selectedRequest.path}</h3>
                <div className="chips">
                  <span className="chip">id: {selectedRequest.requestId}</span>
                  <span className="chip">status: {selectedRequest.status}</span>
                  {selectedRequest.statusCode ? <span className="chip">statusCode: {selectedRequest.statusCode}</span> : null}
                  {selectedRequest.durationMs !== undefined ? <span className="chip">duration: {selectedRequest.durationMs.toFixed(3)}ms</span> : null}
                  {selectedRequest.controller ? <span className="chip">controller: {selectedRequest.controller}</span> : null}
                  {selectedRequest.handler ? <span className="chip">handler: {selectedRequest.handler}</span> : null}
                  {selectedRequest.routeId ? <span className="chip">route: {selectedRequest.routeId}</span> : null}
                </div>
                {selectedRequest.error ? (
                  <article className="inline-diagnostic severity-error">
                    <strong>{selectedRequest.error.name ?? 'Request error'}</strong>
                    <p>{selectedRequest.error.message}</p>
                  </article>
                ) : null}
              </>
            ) : <p className="muted">Select a request trace to inspect handler correlation.</p>}
          </aside>
        </div>
      )}
    </section>
  );
}
