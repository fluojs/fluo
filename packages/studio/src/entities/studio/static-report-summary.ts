import type { StudioReportSummary } from '../../contracts.js';
import type { StudioDashboardState } from './model.js';

type StaticReportSummary = Omit<StudioReportSummary, 'timingTotalMs'> & {
  source: 'report' | 'snapshot';
  timingTotalMs?: number;
};

/**
 * Selects a canonical report summary or derives equivalent fields from a snapshot.
 *
 * @param state Studio state containing a parsed report or snapshot payload.
 * @returns Report-summary fields for the active static snapshot.
 */
export function selectStaticReportSummary(state: StudioDashboardState): StaticReportSummary | undefined {
  const payload = state.staticReport.payload;
  if (payload?.report) {
    return { ...payload.report.summary, source: 'report' };
  }

  const snapshot = state.staticReport.filteredSnapshot;
  if (!snapshot) {
    return undefined;
  }

  return {
    componentCount: snapshot.components.length,
    diagnosticCount: snapshot.diagnostics.length,
    errorCount: snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    healthStatus: snapshot.health.status,
    readinessStatus: snapshot.readiness.status,
    source: 'snapshot',
    ...(payload?.timing ? { timingTotalMs: payload.timing.totalMs } : {}),
    warningCount: snapshot.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
  };
}
