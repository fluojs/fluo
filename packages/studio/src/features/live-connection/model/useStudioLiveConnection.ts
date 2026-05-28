import { useEffect, type Dispatch } from 'react';
import type { StudioConnectionState, StudioLiveEvent } from '../../../contracts.js';
import { validateStudioLiveEvent } from '../../../contracts.js';
import { resolveStudioSidecarConfig } from '../../../shared/lib/studio-config.js';
import type { StudioAction } from './reducer.js';

interface StudioStateResponse {
  events?: unknown[];
  sequence?: number;
}

const LIVE_EVENT_TYPES: StudioLiveEvent['type'][] = [
  'snapshot',
  'request',
  'timing',
  'diagnostic',
  'heartbeat',
  'restart',
  'disconnect',
];

function eventPayloadFromMessage(event: MessageEvent): unknown {
  if (typeof event.data !== 'string') {
    return event.data;
  }

  return JSON.parse(event.data) as unknown;
}

function dispatchConnection(dispatch: Dispatch<StudioAction>, connection: StudioConnectionState): void {
  dispatch({ connection, type: 'connection' });
}

function dispatchLiveEvent(dispatch: Dispatch<StudioAction>, value: unknown): void {
  dispatch({ event: validateStudioLiveEvent(value), type: 'live-event' });
}

function withReplayCursor(eventsUrl: string, sequence: number | undefined): string {
  if (sequence === undefined || !Number.isFinite(sequence) || sequence <= 0) {
    return eventsUrl;
  }

  const base = window.location.origin || 'http://localhost';
  const url = new URL(eventsUrl, base);
  url.searchParams.set('after', String(sequence));
  return eventsUrl.startsWith('http://') || eventsUrl.startsWith('https://')
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

export function useStudioLiveConnection(dispatch: Dispatch<StudioAction>): void {
  useEffect(() => {
    const config = resolveStudioSidecarConfig();
    if (!config) {
      return;
    }

    if (typeof EventSource === 'undefined') {
      dispatchConnection(dispatch, {
        message: 'This browser does not expose EventSource; static/report mode remains available.',
        status: 'error',
      });
      return;
    }

    let closed = false;
    let lastEventAt = Date.now();
    const staleTimer = window.setInterval(() => {
      if (closed) {
        return;
      }

      if (Date.now() - lastEventAt > 20_000) {
        dispatchConnection(dispatch, {
          lastEventAt: new Date(lastEventAt).toISOString(),
          message: 'No Studio event has arrived for 20s; showing stale data until the sidecar reconnects.',
          status: 'stale',
        });
      }
    }, 5_000);

    dispatchConnection(dispatch, {
      message: 'Connecting to the local Studio sidecar…',
      status: 'connecting',
    });

    const handleMessage = (event: MessageEvent) => {
      try {
        lastEventAt = Date.now();
        dispatchLiveEvent(dispatch, eventPayloadFromMessage(event));
      } catch (error) {
        dispatchConnection(dispatch, {
          message: error instanceof Error ? error.message : 'Failed to parse Studio live event.',
          status: 'error',
        });
      }
    };

    let source: EventSource | undefined;
    const openSource = (eventsUrl: string) => {
      source = new EventSource(eventsUrl);
      source.onopen = () => {
        lastEventAt = Date.now();
        dispatchConnection(dispatch, {
          lastEventAt: new Date().toISOString(),
          message: 'Connected to the local Studio sidecar.',
          status: 'connected',
        });
      };

      source.onerror = () => {
        if (!closed) {
          dispatchConnection(dispatch, {
            lastEventAt: new Date(lastEventAt).toISOString(),
            message: 'Studio event stream disconnected; waiting for reconnect.',
            status: 'reconnecting',
          });
        }
      };

      source.addEventListener('message', handleMessage);
      for (const eventType of LIVE_EVENT_TYPES) {
        source.addEventListener(eventType, handleMessage);
      }
    };

    if (config.stateUrl && typeof fetch === 'function') {
      void fetch(config.stateUrl)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Studio state request failed with ${String(response.status)}.`);
          }
          return await response.json() as StudioStateResponse;
        })
        .then((state) => {
          for (const event of state.events ?? []) {
            dispatchLiveEvent(dispatch, event);
          }
          if (!closed) {
            openSource(withReplayCursor(config.eventsUrl, state.sequence));
          }
        })
        .catch((error: unknown) => {
          if (!closed) {
            dispatchConnection(dispatch, {
              message: error instanceof Error ? error.message : String(error),
              status: 'reconnecting',
            });
            openSource(config.eventsUrl);
          }
        });
    } else {
      openSource(config.eventsUrl);
    }

    return () => {
      closed = true;
      window.clearInterval(staleTimer);
      if (source) {
        for (const eventType of LIVE_EVENT_TYPES) {
          source.removeEventListener(eventType, handleMessage);
        }
        source.removeEventListener('message', handleMessage);
        source.close();
      }
    };
  }, [dispatch]);
}
