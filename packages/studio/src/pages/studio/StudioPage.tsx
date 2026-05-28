import { useReducer } from 'react';
import { initialStudioState } from '../../entities/studio/model.js';
import { FileDropZone } from '../../features/file-loader/ui/FileDropZone.js';
import { SnapshotFilters } from '../../features/filters/ui/SnapshotFilters.js';
import { studioReducer } from '../../features/live-connection/model/reducer.js';
import { useStudioLiveConnection } from '../../features/live-connection/model/useStudioLiveConnection.js';
import { ConnectionStatusWidget } from '../../widgets/connection-status/ui/ConnectionStatusWidget.js';
import { DiagnosticsPanel } from '../../widgets/diagnostics/ui/DiagnosticsPanel.js';
import { LiveGraphPanel } from '../../widgets/live-graph/ui/LiveGraphPanel.js';
import { RequestFlowPanel } from '../../widgets/request-flow/ui/RequestFlowPanel.js';
import { RoutesPanel } from '../../widgets/routes/ui/RoutesPanel.js';
import { StaticReportPanel } from '../../widgets/static-report/ui/StaticReportPanel.js';
import { TimingPanel } from '../../widgets/timing/ui/TimingPanel.js';

export function StudioPage() {
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  useStudioLiveConnection(dispatch);

  return (
    <main>
      <header className="studio-hero">
        <div>
          <p className="eyebrow">Fluo Studio</p>
          <h1>Runtime-connected live devtool</h1>
          <p>Inspect live module wiring, provider/controller ownership, HTTP routes, request flow, timings, and diagnostics from <code>fluo dev --studio</code>. Static JSON loading remains available as compatibility mode.</p>
        </div>
        <div className="hero-command"><code>fluo dev --studio</code></div>
      </header>

      <ConnectionStatusWidget state={state} />

      <FileDropZone dispatch={dispatch} state={state} />
      <StaticReportPanel dispatch={dispatch} state={state} />
      <SnapshotFilters dispatch={dispatch} filter={state.filter} />

      <div className="dashboard-grid">
        <LiveGraphPanel dispatch={dispatch} state={state} />
        <RoutesPanel dispatch={dispatch} state={state} />
        <RequestFlowPanel dispatch={dispatch} state={state} />
        <TimingPanel state={state} />
        <DiagnosticsPanel state={state} />
      </div>
    </main>
  );
}
