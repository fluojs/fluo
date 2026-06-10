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

/**
 * Defines Studio Mode values used by the Studio devtool.
 */
export type StudioMode = 'live' | 'static';

/**
 * Describes Static Report State data used by the Studio devtool.
 */
export interface StaticReportState {
  filteredSnapshot?: PlatformShellSnapshot;
  payload?: {
    snapshot?: PlatformShellSnapshot;
    timing?: BootstrapTimingDiagnostics;
  };
  rawJson?: string;
  selectedComponentId?: string;
}

/**
 * Describes Studio Dashboard State data used by the Studio devtool.
 */
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

/**
 * Provides initial Studio State defaults for the Studio devtool.
 */
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

/**
 * Provides select Static Snapshot behavior for the Studio devtool.
 *
 * @param state state value used by select Static Snapshot.
 * @returns The select Static Snapshot result.
 */
export function selectStaticSnapshot(state: StudioDashboardState): PlatformShellSnapshot | undefined {
  return state.staticReport.filteredSnapshot;
}

/**
 * Provides select Original Static Snapshot behavior for the Studio devtool.
 *
 * @param state state value used by select Original Static Snapshot.
 * @returns The unfiltered static snapshot, when one has been loaded.
 */
export function selectOriginalStaticSnapshot(state: StudioDashboardState): PlatformShellSnapshot | undefined {
  return state.staticReport.payload?.snapshot;
}

/**
 * Provides select Static Timing behavior for the Studio devtool.
 *
 * @param state state value used by select Static Timing.
 * @returns The select Static Timing result.
 */
export function selectStaticTiming(state: StudioDashboardState): BootstrapTimingDiagnostics | undefined {
  return state.staticReport.payload?.timing;
}

/**
 * Provides select Live Timing behavior for the Studio devtool.
 *
 * @param state state value used by select Live Timing.
 * @returns The select Live Timing result.
 */
export function selectLiveTiming(state: StudioDashboardState): BootstrapTimingDiagnostics | undefined {
  return state.liveSnapshot?.timing;
}

/**
 * Provides select Live Requests behavior for the Studio devtool.
 *
 * @param state state value used by select Live Requests.
 * @returns The select Live Requests result.
 */
export function selectLiveRequests(state: StudioDashboardState): StudioRequestTrace[] {
  return state.liveSnapshot?.requests ?? [];
}

/**
 * Provides select Live Diagnostics behavior for the Studio devtool.
 *
 * @param state state value used by select Live Diagnostics.
 * @returns The select Live Diagnostics result.
 */
export function selectLiveDiagnostics(state: StudioDashboardState): StudioLiveDiagnostic[] {
  return state.liveSnapshot?.diagnostics ?? [];
}

/**
 * Provides select Live Routes behavior for the Studio devtool.
 *
 * @param state state value used by select Live Routes.
 * @returns The select Live Routes result.
 */
export function selectLiveRoutes(state: StudioDashboardState): StudioRouteDescriptor[] {
  return state.liveSnapshot?.routes ?? [];
}

/**
 * Provides select Selected Static Component behavior for the Studio devtool.
 *
 * @param state state value used by select Selected Static Component.
 * @returns The select Selected Static Component result.
 */
export function selectSelectedStaticComponent(state: StudioDashboardState): PlatformSnapshot | undefined {
  const snapshot = selectStaticSnapshot(state);
  if (!snapshot || snapshot.components.length === 0) {
    return undefined;
  }

  const originalSnapshot = selectOriginalStaticSnapshot(state);
  const selected = state.staticReport.selectedComponentId
    ? snapshot.components.find((component) => component.id === state.staticReport.selectedComponentId)
      ?? originalSnapshot?.components.find((component) => component.id === state.staticReport.selectedComponentId)
    : undefined;
  return selected ?? snapshot.components[0];
}

/**
 * Provides select Selected Route behavior for the Studio devtool.
 *
 * @param state state value used by select Selected Route.
 * @returns The select Selected Route result.
 */
export function selectSelectedRoute(state: StudioDashboardState): StudioRouteDescriptor | undefined {
  const routes = selectLiveRoutes(state);
  if (routes.length === 0) {
    return undefined;
  }

  return routes.find((route) => route.id === state.selectedRouteId) ?? routes[0];
}

/**
 * Provides select Selected Request behavior for the Studio devtool.
 *
 * @param state state value used by select Selected Request.
 * @returns The select Selected Request result.
 */
export function selectSelectedRequest(state: StudioDashboardState): StudioRequestTrace | undefined {
  const requests = selectLiveRequests(state);
  if (requests.length === 0) {
    return undefined;
  }

  return requests.find((request) => request.requestId === state.selectedRequestId) ?? requests[0];
}

/**
 * Provides filter Static Snapshot behavior for the Studio devtool.
 *
 * @param payload payload value used by filter Static Snapshot.
 * @param filter filter value used by filter Static Snapshot.
 * @returns The filter Static Snapshot result.
 */
export function filterStaticSnapshot(payload: StaticReportState['payload'], filter: FilterState): PlatformShellSnapshot | undefined {
  return payload?.snapshot ? applyFilters(payload.snapshot, filter) : undefined;
}

/**
 * Provides retain Recent Events behavior for the Studio devtool.
 *
 * @param events events value used by retain Recent Events.
 * @param maxEvents max Events value used by retain Recent Events.
 * @returns The retain Recent Events result.
 */
export function retainRecentEvents(events: StudioLiveEvent[], maxEvents = 120): StudioLiveEvent[] {
  return events.length > maxEvents ? events.slice(events.length - maxEvents) : events;
}

/**
 * Provides retain Recent Requests behavior for the Studio devtool.
 *
 * @param requests requests value used by retain Recent Requests.
 * @param maxRequests max Requests value used by retain Recent Requests.
 * @returns The retain Recent Requests result.
 */
export function retainRecentRequests(requests: StudioRequestTrace[], maxRequests = 80): StudioRequestTrace[] {
  return requests.length > maxRequests ? requests.slice(requests.length - maxRequests) : requests;
}

/**
 * Provides upsert Request behavior for the Studio devtool.
 *
 * @param requests requests value used by upsert Request.
 * @param next next value used by upsert Request.
 * @returns The upsert Request result.
 */
export function upsertRequest(requests: StudioRequestTrace[], next: StudioRequestTrace): StudioRequestTrace[] {
  const index = requests.findIndex((request) => request.requestId === next.requestId);
  if (index === -1) {
    return retainRecentRequests([next, ...requests]);
  }

  const copy = [...requests];
  copy[index] = { ...copy[index], ...next };
  return retainRecentRequests(copy);
}
