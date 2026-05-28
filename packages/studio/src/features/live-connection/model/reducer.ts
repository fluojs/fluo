import type { ParsedPayload, StudioConnectionState, StudioLiveEvent } from '../../../contracts.js';
import { parseStudioPayload } from '../../../contracts.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import {
  filterStaticSnapshot,
  retainRecentEvents,
  retainRecentRequests,
  upsertRequest,
} from '../../../entities/studio/model.js';

/**
 * Defines Studio Action values used by the Studio devtool.
 */
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

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/**
 * Provides parse Static Studio File behavior for the Studio devtool.
 *
 * @param rawJson raw Json value used by parse Static Studio File.
 * @returns The parse Static Studio File result.
 */
export function parseStaticStudioFile(rawJson: string): ParsedPayload {
  return parseStudioPayload(rawJson);
}

/**
 * Provides studio Reducer behavior for the Studio devtool.
 *
 * @param state state value used by studio Reducer.
 * @param action action value used by studio Reducer.
 * @returns The studio Reducer result.
 */
export function studioReducer(state: StudioDashboardState, action: StudioAction): StudioDashboardState {
  switch (action.type) {
    case 'connection':
      return {
        ...state,
        connection: {
          ...action.connection,
          lastEventAt: action.connection.lastEventAt ?? state.connection.lastEventAt,
        },
        mode: action.connection.status === 'static' ? state.mode : 'live',
      };

    case 'file-error':
      return {
        ...state,
        connection: { message: action.message, status: 'static' },
        message: action.message,
        mode: 'static',
        staticReport: {},
      };

    case 'static-payload': {
      const staticReport = {
        filteredSnapshot: filterStaticSnapshot(action.parsed.payload, state.filter),
        payload: action.parsed.payload,
        rawJson: action.parsed.rawJson,
        selectedComponentId: undefined,
      };

      return {
        ...state,
        connection: {
          message: 'Static/report compatibility mode is active.',
          status: 'static',
        },
        message: action.message,
        mode: 'static',
        staticReport,
      };
    }

    case 'filter-query': {
      const filter = { ...state.filter, query: action.query };
      return {
        ...state,
        filter,
        staticReport: {
          ...state.staticReport,
          filteredSnapshot: filterStaticSnapshot(state.staticReport.payload, filter),
        },
      };
    }

    case 'filter-readiness-toggle': {
      const filter = {
        ...state.filter,
        readinessStatuses: toggleValue(state.filter.readinessStatuses, action.readiness),
      };
      return {
        ...state,
        filter,
        staticReport: {
          ...state.staticReport,
          filteredSnapshot: filterStaticSnapshot(state.staticReport.payload, filter),
        },
      };
    }

    case 'filter-severity-toggle': {
      const filter = {
        ...state.filter,
        severities: toggleValue(state.filter.severities, action.severity),
      };
      return {
        ...state,
        filter,
        staticReport: {
          ...state.staticReport,
          filteredSnapshot: filterStaticSnapshot(state.staticReport.payload, filter),
        },
      };
    }

    case 'select-component':
      return {
        ...state,
        staticReport: {
          ...state.staticReport,
          selectedComponentId: action.componentId,
        },
      };

    case 'select-graph-node':
      return {
        ...state,
        selectedGraphNodeId: action.nodeId,
      };

    case 'select-route':
      return {
        ...state,
        selectedRouteId: action.routeId,
      };

    case 'select-request':
      return {
        ...state,
        selectedRequestId: action.requestId,
      };

    case 'live-event': {
      const event = action.event;
      const base = {
        ...state,
        appId: event.source.appId,
        connection: {
          lastEventAt: event.emittedAt,
          message: `Live ${event.type} event received from ${event.source.runtime}.`,
          status: 'connected' as const,
        },
        epoch: event.epoch,
        events: retainRecentEvents([...state.events, event]),
        mode: 'live' as const,
      };

      if (event.type === 'snapshot') {
        return {
          ...base,
          liveSnapshot: {
            ...event.payload,
            requests: retainRecentRequests(event.payload.requests),
          },
          selectedGraphNodeId: base.selectedGraphNodeId ?? event.payload.graph.nodes[0]?.id,
          selectedRouteId: base.selectedRouteId ?? event.payload.routes[0]?.id,
        };
      }

      if (event.type === 'request') {
        const previousSnapshot = state.liveSnapshot;
        return {
          ...base,
          liveSnapshot: previousSnapshot
            ? {
                ...previousSnapshot,
                requests: upsertRequest(previousSnapshot.requests, event.payload),
              }
            : previousSnapshot,
          selectedRequestId: event.payload.requestId,
        };
      }

      if (event.type === 'timing') {
        return {
          ...base,
          liveSnapshot: state.liveSnapshot
            ? {
                ...state.liveSnapshot,
                timing: event.payload,
              }
            : state.liveSnapshot,
        };
      }

      if (event.type === 'diagnostic') {
        return {
          ...base,
          liveSnapshot: state.liveSnapshot
            ? {
                ...state.liveSnapshot,
                diagnostics: [event.payload, ...state.liveSnapshot.diagnostics].slice(0, 80),
              }
            : state.liveSnapshot,
        };
      }

      if (event.type === 'restart') {
        return {
          ...base,
          connection: {
            lastEventAt: event.emittedAt,
            message: event.payload.reason ?? `Runtime restart ${event.payload.phase}.`,
            status: event.payload.phase === 'started' ? 'connected' : 'restarting',
          },
        };
      }

      if (event.type === 'disconnect') {
        return {
          ...base,
          connection: {
            lastEventAt: event.emittedAt,
            message: event.payload.reason ?? 'Runtime disconnected from the Studio sidecar.',
            status: 'disconnected',
          },
        };
      }

      return base;
    }
  }
}
