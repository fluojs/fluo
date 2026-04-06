import type { MaybePromise } from '@konekti/core';

import type { Dispatcher } from './types.js';

export interface ServerBackedHttpAdapterRealtimeCapability {
  kind: 'server-backed';
  server: unknown;
}

export interface UnsupportedHttpAdapterRealtimeCapability {
  kind: 'unsupported';
  mode: 'no-op';
  reason: string;
}

export type HttpAdapterRealtimeCapability =
  | ServerBackedHttpAdapterRealtimeCapability
  | UnsupportedHttpAdapterRealtimeCapability;

export function createServerBackedHttpAdapterRealtimeCapability(
  server: unknown,
): ServerBackedHttpAdapterRealtimeCapability {
  return {
    kind: 'server-backed',
    server,
  };
}

export function createUnsupportedHttpAdapterRealtimeCapability(
  reason: string,
): UnsupportedHttpAdapterRealtimeCapability {
  return {
    kind: 'unsupported',
    mode: 'no-op',
    reason,
  };
}

/**
 * Minimal HTTP adapter contract that binds the application lifecycle to a transport implementation.
 */
export interface HttpApplicationAdapter {
  /**
   * Returns the underlying transport server object when the adapter exposes one.
   *
   * @returns The transport-native server instance, or `undefined` when the adapter does not expose it.
   */
  getServer?(): unknown;

  getRealtimeCapability?(): HttpAdapterRealtimeCapability;

  /**
   * Starts the adapter and binds request dispatching to the framework dispatcher.
   *
   * @param dispatcher Dispatcher created by `@konekti/http` that executes the request pipeline.
   * @returns A promise that resolves when the adapter is ready to accept requests.
   */
  listen(dispatcher: Dispatcher): MaybePromise<void>;

  /**
   * Stops the adapter and releases transport resources.
   *
   * @param signal Optional shutdown reason propagated by runtime lifecycle hooks.
   * @returns A promise that resolves after transport shutdown is complete.
   */
  close(signal?: string): MaybePromise<void>;
}

/**
 * Creates a no-op adapter that preserves lifecycle behavior without binding a real HTTP server.
 *
 * @returns A lifecycle-compatible adapter whose `listen()` and `close()` methods resolve immediately.
 */
export function createNoopHttpApplicationAdapter(): HttpApplicationAdapter {
  return {
    async close() {},
    getRealtimeCapability() {
      return createUnsupportedHttpAdapterRealtimeCapability(
        'No-op HTTP adapter does not expose a server-backed realtime capability.',
      );
    },
    async listen() {},
  };
}
