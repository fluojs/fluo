import { describe, expect, it } from 'vitest';
import { isStudioLiveEvent, parseStudioLiveEvent, type StudioLiveEvent } from './contracts.js';
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
});
