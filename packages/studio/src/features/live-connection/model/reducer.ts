import type { StudioConnectionStatus } from '../../../contracts.js';
import type { StudioAction } from '../../../entities/studio/actions.js';
import type { StudioDashboardState, StudioMode } from '../../../entities/studio/model.js';
import {
  filterStaticSnapshot,
  retainRecentEvents,
  retainRecentRequests,
  upsertRequest,
} from '../../../entities/studio/model.js';

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function modeForConnectionStatus(currentMode: StudioMode, status: StudioConnectionStatus): StudioMode {
  if (status === 'static') {
    return 'static';
  }

  if (status === 'error') {
    return currentMode;
  }

  return 'live';
}

function withoutLiveSession(state: StudioDashboardState): StudioDashboardState {
  return {
    ...state,
    appId: undefined,
    epoch: undefined,
    events: [],
    liveSnapshot: undefined,
    selectedGraphNodeId: undefined,
    selectedRequestId: undefined,
    selectedRouteId: undefined,
  };
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
        mode: modeForConnectionStatus(state.mode, action.connection.status),
      };

    case 'file-error':
      return {
        ...withoutLiveSession(state),
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
        ...withoutLiveSession(state),
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
