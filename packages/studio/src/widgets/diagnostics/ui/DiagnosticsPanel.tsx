import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectLiveDiagnostics } from '../../../entities/studio/model.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';

interface DiagnosticsPanelProps {
  state: StudioDashboardState;
}

/**
 * Provides Diagnostics Panel behavior for the Studio devtool.
 */
export function DiagnosticsPanel({ state }: DiagnosticsPanelProps) {
  const diagnostics = selectLiveDiagnostics(state);

  return (
    <section className="card live-diagnostics-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Runtime diagnostics</p>
          <h2>Live diagnostics</h2>
        </div>
        <span className="mode-badge">{diagnostics.length} issues</span>
      </div>
      {diagnostics.length === 0 ? <EmptyState action="Runtime and request diagnostics will appear here when emitted." title="No live diagnostics yet." /> : (
        <div className="diagnostics-list">
          {diagnostics.map((diagnostic, index) => (
            <article className={`card issue severity-${diagnostic.severity}`} key={`${diagnostic.code}:${diagnostic.targetId ?? index}`}>
              <h3>{diagnostic.code}</h3>
              <p><strong>severity:</strong> {diagnostic.severity}{diagnostic.targetId ? <> · <strong>target:</strong> {diagnostic.targetId}</> : null}</p>
              <p>{diagnostic.message}</p>
              {diagnostic.scope ? <p><strong>scope:</strong> {diagnostic.scope}</p> : null}
              {diagnostic.fixHint ? <p><strong>fix hint:</strong> {diagnostic.fixHint}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
