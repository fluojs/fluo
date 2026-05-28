import type { BootstrapTimingDiagnostics } from '@fluojs/runtime';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { selectLiveTiming, selectStaticTiming } from '../../../entities/studio/model.js';
import { EmptyState } from '../../../shared/ui/EmptyState.js';

interface TimingPanelProps {
  state: StudioDashboardState;
}

function phaseTone(durationMs: number, totalMs: number): string {
  if (durationMs > Math.max(50, totalMs * 0.5)) return 'danger';
  if (durationMs > Math.max(20, totalMs * 0.25)) return 'warning';
  return 'muted';
}

function TimingTable({ label, timing }: { label: string; timing?: BootstrapTimingDiagnostics }) {
  if (!timing) {
    return <EmptyState action="Bootstrap timing appears after runtime snapshot or a timing JSON load." title="No timing diagnostics yet." />;
  }

  return (
    <div>
      <div className="timing-total">
        <span>{label}</span>
        <strong>{timing.totalMs.toFixed(3)}ms</strong>
      </div>
      <table>
        <thead>
          <tr><th>phase</th><th>duration (ms)</th><th>slow-area label</th></tr>
        </thead>
        <tbody>
          {timing.phases.map((phase) => (
            <tr key={`${phase.name}:${String(phase.durationMs)}`}>
              <td>{phase.name}</td>
              <td>{phase.durationMs.toFixed(3)}</td>
              <td><span className={`status-pill status-pill-${phaseTone(phase.durationMs, timing.totalMs)}`}>{phaseTone(phase.durationMs, timing.totalMs)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimingPanel({ state }: TimingPanelProps) {
  return (
    <section className="card timing-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Bootstrap, restart, and request timing</p>
          <h2>Timing</h2>
        </div>
      </div>
      <div className="timing-grid">
        <TimingTable label="Live bootstrap timing" timing={selectLiveTiming(state)} />
        <TimingTable label="Static/report timing" timing={selectStaticTiming(state)} />
      </div>
    </section>
  );
}
