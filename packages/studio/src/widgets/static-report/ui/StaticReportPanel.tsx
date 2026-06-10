import type { Dispatch, KeyboardEvent, MouseEvent } from 'react';
import type { PlatformSnapshot } from '@fluojs/runtime';
import { renderMermaid } from '../../../contracts.js';
import type { StudioAction } from '../../../entities/studio/actions.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectOriginalStaticSnapshot, selectSelectedStaticComponent, selectStaticSnapshot } from '../../../entities/studio/model.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';
import { inspectComponentConnections, renderDiagnostics, renderGraphSvg } from '../../../viewer-rendering.js';

interface StaticReportPanelProps {
  dispatch: Dispatch<StudioAction>;
  state: StudioDashboardState;
}

function renderSnapshotSummary(snapshot: ReturnType<typeof selectStaticSnapshot>) {
  if (!snapshot) {
    return <p className="muted">No platform snapshot loaded.</p>;
  }

  const ready = snapshot.components.filter((component) => component.readiness.status === 'ready').length;
  const degraded = snapshot.components.filter((component) => component.readiness.status === 'degraded').length;
  const notReady = snapshot.components.filter((component) => component.readiness.status === 'not-ready').length;

  return (
    <div className="chips">
      <span className="chip">generatedAt: {snapshot.generatedAt}</span>
      <span className="chip">aggregate readiness: {snapshot.readiness.status}</span>
      <span className="chip">aggregate health: {snapshot.health.status}</span>
      <span className="chip">components: {snapshot.components.length}</span>
      <span className="chip">diagnostics: {snapshot.diagnostics.length}</span>
      <span className="chip">ready/degraded/not-ready: {ready}/{degraded}/{notReady}</span>
    </div>
  );
}

function renderDetails(component: PlatformSnapshot | undefined) {
  if (!component) {
    return <p className="muted">No component selected.</p>;
  }

  return (
    <>
      <h3>{component.id}</h3>
      <p className="muted">kind: <strong>{component.kind}</strong> · state: <strong>{component.state}</strong></p>
      <div className="chips">
        <span className="chip">readiness: {component.readiness.status}</span>
        <span className="chip">critical: {component.readiness.critical ? 'true' : 'false'}</span>
        <span className="chip">health: {component.health.status}</span>
        <span className="chip">ownership: owns={component.ownership.ownsResources ? 'true' : 'false'}/external={component.ownership.externallyManaged ? 'true' : 'false'}</span>
        {component.dependencies.length > 0
          ? component.dependencies.map((entry) => <span className="chip" key={entry}>dependsOn: {entry}</span>)
          : <span className="chip">dependsOn: none</span>}
      </div>
      <p className="muted">telemetry namespace: <code>{component.telemetry.namespace}</code></p>
      <h4>Sanitized details</h4>
      <pre>{JSON.stringify(component.details, null, 2)}</pre>
    </>
  );
}

function ConnectionExplorer({ dispatch, selectedId, state }: StaticReportPanelProps & { selectedId?: string }) {
  const originalSnapshot = selectOriginalStaticSnapshot(state);
  const summary = inspectComponentConnections(selectStaticSnapshot(state), selectedId, originalSnapshot?.components);
  if (!summary) {
    return <p className="muted">Load a platform snapshot to explore component connections.</p>;
  }

  return (
    <div>
      <div className="connection-hero">
        <div>
          <p className="eyebrow">Selected component</p>
          <h3>{summary.component.id}</h3>
          <p className="muted">{summary.component.kind} · state {summary.component.state}</p>
        </div>
        <div className="connection-metrics" aria-label="Selected component connection counts">
          <span><strong>{summary.outgoing.length}</strong> internal deps</span>
          <span><strong>{summary.externalDependencies.length}</strong> external deps</span>
          <span><strong>{summary.incoming.length}</strong> dependents</span>
          <span><strong>{summary.diagnostics.length}</strong> diagnostics</span>
        </div>
      </div>
      <div className="connection-grid">
        <section className="connection-group">
          <h4>Outgoing dependencies</h4>
          {summary.outgoing.length > 0
            ? summary.outgoing.map((component) => (
                <button className="connection-button" data-select-component={component.id} key={component.id} onClick={() => dispatch({ componentId: component.id, type: 'select-component' })} type="button">
                  <span>{component.id}</span>
                  <small>dependency · {component.kind} · {component.readiness.status}</small>
                </button>
              ))
            : <p className="muted">No internal dependencies.</p>}
        </section>
        <section className="connection-group">
          <h4>Incoming dependents</h4>
          {summary.incoming.length > 0
            ? summary.incoming.map((component) => (
                <button className="connection-button" data-select-component={component.id} key={component.id} onClick={() => dispatch({ componentId: component.id, type: 'select-component' })} type="button">
                  <span>{component.id}</span>
                  <small>dependent · {component.kind} · {component.readiness.status}</small>
                </button>
              ))
            : <p className="muted">No incoming dependents.</p>}
        </section>
        <section className="connection-group">
          <h4>External dependencies</h4>
          {summary.externalDependencies.length > 0
            ? summary.externalDependencies.map((dependency) => <span className="connection-pill external-pill" key={dependency}>{dependency}</span>)
            : <p className="muted">No external dependencies.</p>}
        </section>
        <section className="connection-group">
          <h4>Related diagnostics</h4>
          {summary.diagnostics.length > 0
            ? summary.diagnostics.map((issue) => (
                <article className={`connection-diagnostic severity-${issue.severity}`} key={issue.code}>
                  <strong>{issue.code}</strong>
                  <span>{issue.severity} · {issue.componentId}</span>
                  <p>{issue.message}</p>
                </article>
              ))
            : <p className="muted">No diagnostics for this neighborhood.</p>}
        </section>
      </div>
    </div>
  );
}

/**
 * Provides Static Report Panel behavior for the Studio devtool.
 */
export function StaticReportPanel({ dispatch, state }: StaticReportPanelProps) {
  const snapshot = selectStaticSnapshot(state);
  const originalSnapshot = selectOriginalStaticSnapshot(state);
  const selected = selectSelectedStaticComponent(state);
  const mermaidText = snapshot ? renderMermaid(snapshot) : '';
  const graphSvg = snapshot && snapshot.components.length > 0
    ? renderGraphSvg(snapshot, selected?.id, originalSnapshot?.components)
    : '<p class="muted">No platform components loaded.</p>';

  function selectComponentFromEvent(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof SVGElement)) {
      return;
    }

    const componentId = target.dataset.component;
    if (!componentId) {
      return;
    }

    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    dispatch({ componentId, type: 'select-component' });
  }

  return (
    <>
      <section className="card snapshot-summary-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Static/report compatibility</p>
            <h2>Snapshot summary</h2>
          </div>
        </div>
        {renderSnapshotSummary(snapshot)}
      </section>

      <section className="card graph-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Compatibility graph</p>
            <h2>Platform dependency graph</h2>
          </div>
          <span className="mode-badge">static</span>
        </div>
        <p className="muted">Component dependencies are rendered directly from the shared platform snapshot schema. Select a node to inspect its dependency neighborhood.</p>
        <div
          dangerouslySetInnerHTML={{ __html: graphSvg }}
          id="graph-host"
          onClick={(event) => selectComponentFromEvent(event)}
          onKeyDown={(event) => selectComponentFromEvent(event)}
        />
      </section>

      <section className="card inspector-card">
        <h2>Connection explorer</h2>
        <p className="muted">Studio owns snapshot inspection and rendering: use this panel to inspect incoming and outgoing component relationships without changing CLI export semantics.</p>
        <ConnectionExplorer dispatch={dispatch} selectedId={selected?.id} state={state} />
      </section>

      <section className="split-grid section-pair">
        <div className="card" id="details-panel">
          <h2>Component details</h2>
          {renderDetails(selected)}
        </div>
        <div className="card">
          <h2>Mermaid output</h2>
          <pre>{mermaidText || 'No snapshot loaded.'}</pre>
        </div>
      </section>

      <section className="card">
        <h2>Diagnostics issues</h2>
        <p className="muted">Fix hints and dependency chains are rendered from <code>diagnostics.fixHint</code> and <code>diagnostics.dependsOn</code>.</p>
        {snapshot
          ? <div dangerouslySetInnerHTML={{ __html: renderDiagnostics(snapshot) }} />
          : <EmptyState action="Load a Studio JSON artifact to inspect diagnostics." title="No platform snapshot loaded." />}
      </section>
    </>
  );
}
