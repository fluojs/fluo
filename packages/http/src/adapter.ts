import type { MaybePromise } from '@konekti/core';

import type { Dispatcher } from './types.js';

/**
 * Minimal HTTP adapter contract that binds the application lifecycle to a transport implementation.
 */
export interface HttpApplicationAdapter {
  getServer?(): unknown;
  listen(dispatcher: Dispatcher): MaybePromise<void>;
  close(signal?: string): MaybePromise<void>;
}

/**
 * Creates a no-op adapter that preserves lifecycle behavior without binding a real HTTP server.
 */
export function createNoopHttpApplicationAdapter(): HttpApplicationAdapter {
  return {
    async close() {},
    async listen() {},
  };
}
