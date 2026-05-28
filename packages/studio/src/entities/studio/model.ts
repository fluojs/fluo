import type { BootstrapTimingDiagnostics, PlatformShellSnapshot, PlatformSnapshot } from '@fluojs/runtime';
import type {
  FilterState,
  StudioConnectionState,
  StudioLiveDiagnostic,
  StudioLiveEvent,
  StudioLiveSnapshot,
  StudioRequestTrace,
  StudioRouteDescriptor,
} from '../../contracts.js';
import { applyFilters } from '../../contracts.js';

export type StudioMode = 'live' | 'static';

export interface StaticReportState {
  filteredSnapshot?: PlatformShellSnapshot;
  payload?: {
    snapshot?: PlatformShellSnapshot;
    timing?: BootstrapTimingDiagnostics;
  };
  rawJson?: string;
  selectedComponentId?: string;
}

export interface StudioDashboardState {
  appId?: string;
  connection: StudioConnectionState;
  epoch?: string;
  events: StudioLiveEvent[];
  filter: FilterState;
  liveSnapshot?: StudioLiveSnapshot;
  message?: string;
  mode: StudioMode;
  selectedGraphNodeId?: string;
  selectedRequestId?: string;
  selectedRouteId?: string;
  staticReport: StaticReportState;
}

export const initialStudioState: StudioDashboardState = {
  connection: {
    message: 'Studio is waiting for a live sidecar or a static diagnostics file.',
    status: 'static',
  },
  events: [],
  filter: {
    query: '',
    readinessStatuses: [],
    severities: [],
  },
  mode: 'static',
  staticReport: {},
};

export function selectStaticSnapshot(state: StudioDashboardState): PlatformShellSnapshot | undefined {
  return state.staticReport.filteredSnapshot;
}

export function selectStaticTiming(state: StudioDashboardState): BootstrapTimingDiagnostics | undefined {
  return state.staticReport.payload?.timing;
}

export function selectLiveTiming(state: StudioDashboardState): BootstrapTimingDiagnostics | undefined {
  return state.liveSnapshot?.timing;
}

export function selectLiveRequests(state: StudioDashboardState): StudioRequestTrace[] {
  return state.liveSnapshot?.requests ?? [];
}

export function selectLiveDiagnostics(state: StudioDashboardState): StudioLiveDiagnostic[] {
  return state.liveSnapshot?.diagnostics ?? [];
}

export function selectLiveRoutes(state: StudioDashboardState): StudioRouteDescriptor[] {
  return state.liveSnapshot?.routes ?? [];
}

export function selectSelectedStaticComponent(state: StudioDashboardState): PlatformSnapshot | undefined {
  const snapshot = selectStaticSnapshot(state);
  if (!snapshot || snapshot.components.length === 0) {
    return undefined;
  }

  const selected = state.staticReport.selectedComponentId
    ? snapshot.components.find((component) => component.id === state.staticReport.selectedComponentId)
    : undefined;
  return selected ?? snapshot.components[0];
}

export function selectSelectedRoute(state: StudioDashboardState): StudioRouteDescriptor | undefined {
  const routes = selectLiveRoutes(state);
  if (routes.length === 0) {
    return undefined;
  }

  return routes.find((route) => route.id === state.selectedRouteId) ?? routes[0];
}

export function selectSelectedRequest(state: StudioDashboardState): StudioRequestTrace | undefined {
  const requests = selectLiveRequests(state);
  if (requests.length === 0) {
    return undefined;
  }

  return requests.find((request) => request.requestId === state.selectedRequestId) ?? requests[0];
}

export function filterStaticSnapshot(payload: StaticReportState['payload'], filter: FilterState): PlatformShellSnapshot | undefined {
  return payload?.snapshot ? applyFilters(payload.snapshot, filter) : undefined;
}

export function retainRecentEvents(events: StudioLiveEvent[], maxEvents = 120): StudioLiveEvent[] {
  return events.length > maxEvents ? events.slice(events.length - maxEvents) : events;
}

export function retainRecentRequests(requests: StudioRequestTrace[], maxRequests = 80): StudioRequestTrace[] {
  return requests.length > maxRequests ? requests.slice(requests.length - maxRequests) : requests;
}

export function upsertRequest(requests: StudioRequestTrace[], next: StudioRequestTrace): StudioRequestTrace[] {
  const index = requests.findIndex((request) => request.requestId === next.requestId);
  if (index === -1) {
    return retainRecentRequests([next, ...requests]);
  }

  const copy = [...requests];
  copy[index] = { ...copy[index], ...next };
  return retainRecentRequests(copy);
}
