import { describe, expect, it } from 'vitest';
import { isStudioLiveEvent, parseStudioLiveEvent, parseStudioPayload, type StudioLiveEvent } from './contracts.js';
import { initialStudioState } from './entities/studio/model.js';
import { studioReducer } from './features/live-connection/model/reducer.js';

const source = { appId: 'app-test', runtime: 'node' } as const;

function eventBase(sequence: number) {
  return {
    emittedAt: '2026-05-28T00:00:02.000Z',
    epoch: 'epoch-1',
    eventId: `epoch-1:${String(sequence)}`,
    sequence,
    source,
    version: 1 as const,
  };
}

const liveEvents: readonly StudioLiveEvent[] = [
  {
    ...eventBase(1),
    payload: {
      appId: 'app-test',
      diagnostics: [],
      generatedAt: '2026-05-28T00:00:02.000Z',
      graph: {
        edges: [{ from: 'module:app', id: 'edge:1', kind: 'owns_controller', to: 'controller:health' }],
        nodes: [
          { id: 'module:app', kind: 'module', label: 'AppModule', status: 'active' },
          { id: 'controller:health', kind: 'controller', label: 'HealthController' },
        ],
      },
      requests: [],
      routes: [{ controller: 'HealthController', handler: 'getHealth', id: 'route:health', method: 'GET', path: '/health' }],
      version: 1,
    },
    type: 'snapshot',
  },
  {
    ...eventBase(2),
    payload: {
      controller: 'HealthController',
      durationMs: 2.5,
      finishedAt: '2026-05-28T00:00:03.000Z',
      handler: 'getHealth',
      method: 'GET',
      path: '/health',
      requestId: 'request-1',
      routeId: 'route:health',
      startedAt: '2026-05-28T00:00:02.500Z',
      status: 'succeeded',
      statusCode: 200,
      url: 'http://localhost:3000/health',
    },
    type: 'request',
  },
  {
    ...eventBase(3),
    payload: {
      phases: [{ durationMs: 1.25, name: 'bootstrap_module' }],
      totalMs: 1.25,
      version: 1,
    },
    type: 'timing',
  },
  {
    ...eventBase(4),
    payload: {
      code: 'BOOTSTRAP_DEGRADED',
      message: 'Bootstrap completed with degraded readiness.',
      severity: 'warning',
      targetId: 'module:app',
    },
    type: 'diagnostic',
  },
  { ...eventBase(5), payload: { uptimeMs: 12_000 }, type: 'heartbeat' },
  { ...eventBase(6), payload: { phase: 'stopping', reason: 'source changed' }, type: 'restart' },
  { ...eventBase(7), payload: { reason: 'dev server closed' }, type: 'disconnect' },
] as const;

describe('Studio live event contracts', () => {
  it('accepts every documented runtime-connected event kind', () => {
    for (const event of liveEvents) {
      expect(isStudioLiveEvent(event)).toBe(true);
      expect(parseStudioLiveEvent(JSON.stringify(event))).toEqual(event);
    }
  });

  it('rejects body-like request fields before Studio state can retain them', () => {
    const bodyLikeFields = ['body', 'headers', 'payload', 'rawBody', 'requestBody', 'responseBody'] as const;

    for (const fieldName of bodyLikeFields) {
      const requestEvent = {
        ...liveEvents[1],
        payload: {
          ...liveEvents[1].payload,
          [fieldName]: fieldName === 'headers' ? { authorization: 'Bearer secret' } : 'private-content',
        },
      };

      expect(isStudioLiveEvent(requestEvent)).toBe(false);
      expect(() => parseStudioLiveEvent(JSON.stringify(requestEvent))).toThrow(
        'Studio live request traces must not include request or response body payload fields.',
      );
    }
  });

  it('maps restart and disconnect events to documented connection states', () => {
    const restarting = studioReducer(initialStudioState, { event: liveEvents[5], type: 'live-event' });
    expect(restarting.connection.status).toBe('restarting');
    expect(restarting.connection.message).toBe('source changed');

    const restartedEvent: StudioLiveEvent = { ...eventBase(8), payload: { phase: 'started' }, type: 'restart' };
    const restarted = studioReducer(restarting, { event: restartedEvent, type: 'live-event' });
    expect(restarted.connection.status).toBe('connected');

    const disconnected = studioReducer(restarted, { event: liveEvents[6], type: 'live-event' });
    expect(disconnected.connection.status).toBe('disconnected');
    expect(disconnected.connection.message).toBe('dev server closed');
  });

  it('clears stale live session state when static/report loading takes over', () => {
    const liveState = studioReducer(initialStudioState, { event: liveEvents[0], type: 'live-event' });
    expect(liveState.mode).toBe('live');
    expect(liveState.liveSnapshot).toBeDefined();
    expect(liveState.selectedGraphNodeId).toBe('module:app');

    const staticState = studioReducer(liveState, {
      message: 'Diagnostics file loaded successfully.',
      parsed: parseStudioPayload(
        JSON.stringify({
          components: [],
          diagnostics: [],
          generatedAt: '2026-05-28T00:00:03.000Z',
          health: { status: 'healthy' },
          readiness: { critical: true, status: 'ready' },
        }),
      ),
      type: 'static-payload',
    });

    expect(staticState.mode).toBe('static');
    expect(staticState.liveSnapshot).toBeUndefined();
    expect(staticState.events).toEqual([]);
    expect(staticState.selectedGraphNodeId).toBeUndefined();
    expect(staticState.selectedRequestId).toBeUndefined();
    expect(staticState.selectedRouteId).toBeUndefined();
  });

  it('keeps static/report mode when static clipboard feedback reports an error', () => {
    const staticState = studioReducer(initialStudioState, {
      connection: { message: 'Clipboard API is unavailable.', status: 'error' },
      type: 'connection',
    });

    expect(staticState.mode).toBe('static');
    expect(staticState.connection.status).toBe('error');
  });
});
