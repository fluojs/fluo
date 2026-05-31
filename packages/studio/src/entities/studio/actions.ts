import type { ParsedPayload, StudioConnectionState, StudioLiveEvent } from '../../contracts.js';
import type { StudioDashboardState } from './model.js';

export type StudioAction =
  | { type: 'connection'; connection: StudioConnectionState }
  | { type: 'file-error'; message: string }
  | { type: 'filter-readiness-toggle'; readiness: StudioDashboardState['filter']['readinessStatuses'][number] }
  | { type: 'filter-query'; query: string }
  | { type: 'filter-severity-toggle'; severity: StudioDashboardState['filter']['severities'][number] }
  | { type: 'live-event'; event: StudioLiveEvent }
  | { type: 'select-component'; componentId: string }
  | { type: 'select-graph-node'; nodeId: string }
  | { type: 'select-request'; requestId: string }
  | { type: 'select-route'; routeId: string }
  | { type: 'static-payload'; parsed: ParsedPayload; message: string };
