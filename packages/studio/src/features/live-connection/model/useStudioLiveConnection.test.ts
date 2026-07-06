// @vitest-environment happy-dom

import { createElement, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioLiveEvent } from '../../../contracts.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { initialStudioState } from '../../../entities/studio/model.js';
import { studioReducer } from './reducer.js';
import { useStudioLiveConnection } from './useStudioLiveConnection.js';

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly url: string;
  closed = false;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: StudioLiveEvent): void {
    this.emitRaw(type, JSON.stringify(event));
  }

  emitRaw(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

const liveEventTypes = ['snapshot', 'request', 'timing', 'diagnostic', 'heartbeat', 'restart', 'disconnect'] as const;

function liveSnapshotEvent(): StudioLiveEvent {
  return {
    emittedAt: '2026-05-28T00:00:02.000Z',
    epoch: 'epoch-1',
    eventId: 'epoch-1:1',
    payload: {
      appId: 'app-test',
      diagnostics: [],
      generatedAt: '2026-05-28T00:00:02.000Z',
      graph: { edges: [], nodes: [] },
      requests: [],
      routes: [],
      version: 1,
    },
    sequence: 1,
    source: { appId: 'app-test', runtime: 'node' },
    type: 'snapshot',
    version: 1,
  };
}

function liveRestartEvent(phase: 'started' | 'stopping'): StudioLiveEvent {
  return {
    emittedAt: '2026-05-28T00:00:03.000Z',
    epoch: 'epoch-1',
    eventId: `epoch-1:restart-${phase}`,
    payload: { phase, reason: phase === 'started' ? 'restart complete' : 'source changed' },
    sequence: phase === 'started' ? 3 : 2,
    source: { appId: 'app-test', runtime: 'node' },
    type: 'restart',
    version: 1,
  };
}

function liveDisconnectEvent(): StudioLiveEvent {
  return {
    emittedAt: '2026-05-28T00:00:04.000Z',
    epoch: 'epoch-1',
    eventId: 'epoch-1:disconnect',
    payload: { reason: 'dev server closed' },
    sequence: 4,
    source: { appId: 'app-test', runtime: 'node' },
    type: 'disconnect',
    version: 1,
  };
}

function liveHeartbeatEvent(sequence: number): StudioLiveEvent {
  return {
    emittedAt: `2026-05-28T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    epoch: 'epoch-1',
    eventId: `epoch-1:heartbeat-${String(sequence)}`,
    payload: { uptimeMs: sequence * 1_000 },
    sequence,
    source: { appId: 'app-test', runtime: 'node' },
    type: 'heartbeat',
    version: 1,
  };
}

describe('useStudioLiveConnection', () => {
  afterEach(() => {
    delete (window as typeof window & { __FLUO_STUDIO__?: unknown }).__FLUO_STUDIO__;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeEventSource.instances.length = 0;
  });

  it('aborts initial state replay and prevents live dispatch after unmount', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    let fetchSignal: AbortSignal | undefined;
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }),
    );
    (window as typeof window & { __FLUO_STUDIO__?: { eventsUrl: string; stateUrl: string } }).__FLUO_STUDIO__ = {
      eventsUrl: '/api/events?token=test-token',
      stateUrl: '/api/state?token=test-token',
    };

    const observedStates: StudioDashboardState[] = [];
    function Harness() {
      const [state, dispatch] = useReducer(studioReducer, initialStudioState);
      observedStates.push(state);
      useStudioLiveConnection(dispatch);
      return null;
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    root.render(createElement(Harness));

    await vi.waitFor(() => {
      expect(fetchSignal).toBeDefined();
    });
    root.unmount();
    if (!fetchSignal) {
      throw new Error('Expected the Studio state fetch to receive an AbortSignal.');
    }
    expect(fetchSignal.aborted).toBe(true);

    resolveFetch(new Response(JSON.stringify({ events: [liveSnapshotEvent()], sequence: 4 }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(observedStates.some((state) => state.events.length > 0)).toBe(false);
  });

  it('reports the full live connection lifecycle state set', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    (window as typeof window & { __FLUO_STUDIO__?: { eventsUrl: string } }).__FLUO_STUDIO__ = {
      eventsUrl: '/api/events?token=test-token',
    };

    const observedStatuses: StudioDashboardState['connection']['status'][] = [];
    function Harness() {
      const [state, dispatch] = useReducer(studioReducer, initialStudioState);
      observedStatuses.push(state.connection.status);
      useStudioLiveConnection(dispatch);
      return createElement('output', null, state.connection.status);
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    root.render(createElement(Harness));

    await vi.waitFor(() => {
      expect(observedStatuses).toContain('connecting');
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    const source = FakeEventSource.instances[0];
    source?.onopen?.(new Event('open'));
    await vi.waitFor(() => {
      expect(observedStatuses).toContain('connected');
    });

    vi.advanceTimersByTime(25_001);
    await vi.waitFor(() => {
      expect(observedStatuses).toContain('stale');
    });

    source?.emit('heartbeat', liveHeartbeatEvent(5));
    await vi.waitFor(() => {
      expect(observedStatuses.at(-1)).toBe('connected');
    });

    vi.advanceTimersByTime(25_001);
    await vi.waitFor(() => {
      expect(observedStatuses.at(-1)).toBe('stale');
    });

    source?.onerror?.(new Event('error'));
    await vi.waitFor(() => {
      expect(observedStatuses).toContain('reconnecting');
    });

    source?.emit('restart', liveRestartEvent('stopping'));
    await vi.waitFor(() => {
      expect(observedStatuses).toContain('restarting');
    });
    source?.emit('restart', liveRestartEvent('started'));
    await vi.waitFor(() => {
      expect(observedStatuses.at(-1)).toBe('connected');
    });
    source?.emit('disconnect', liveDisconnectEvent());
    await vi.waitFor(() => {
      expect(observedStatuses).toContain('disconnected');
    });
    source?.emitRaw('message', '{"type":"not-a-studio-event"}');

    await vi.waitFor(() => {
      expect(observedStatuses).toEqual(expect.arrayContaining([
        'static',
        'connecting',
        'connected',
        'stale',
        'reconnecting',
        'restarting',
        'disconnected',
        'error',
      ]));
    });

    root.unmount();
  });

  it('closes the event source, listeners, and stale timer on unmount', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    vi.stubGlobal('EventSource', FakeEventSource);
    (window as typeof window & { __FLUO_STUDIO__?: { eventsUrl: string } }).__FLUO_STUDIO__ = {
      eventsUrl: '/api/events?token=test-token',
    };

    function Harness() {
      const [state, dispatch] = useReducer(studioReducer, initialStudioState);
      useStudioLiveConnection(dispatch);
      return createElement('output', null, state.connection.status);
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    root.render(createElement(Harness));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0];
    expect(source?.listeners.get('message')?.size).toBe(1);
    for (const eventType of liveEventTypes) {
      expect(source?.listeners.get(eventType)?.size).toBe(1);
    }

    root.unmount();

    expect(source?.closed).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(source?.listeners.get('message')?.size).toBe(0);
    for (const eventType of liveEventTypes) {
      expect(source?.listeners.get(eventType)?.size).toBe(0);
    }
  });
});
