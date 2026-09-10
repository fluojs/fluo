import type { MaybePromise } from '@fluojs/core';

import type { Dispatcher } from './types.js';

/**
 * Describes the server backed http adapter realtime capability contract.
 */
export interface ServerBackedHttpAdapterRealtimeCapability {
  kind: 'server-backed';
  server: unknown;
}

/**
 * Describes the unsupported http adapter realtime capability contract.
 */
export interface UnsupportedHttpAdapterRealtimeCapability {
  kind: 'unsupported';
  mode: 'no-op';
  reason: string;
}

/**
 * Describes the fetch style http adapter realtime capability contract.
 */
export interface FetchStyleHttpAdapterRealtimeCapability {
  bindingInstallation?: HttpAdapterRealtimeBindingInstallation;
  contract: 'raw-websocket-expansion';
  kind: 'fetch-style';
  mode: 'request-upgrade';
  reason: string;
  support: 'contract-only' | 'supported';
  version: 1;
}

/**
 * Versioned host installation seam for protocol-owned fetch-style realtime bindings.
 */
export interface HttpAdapterRealtimeBindingInstallation {
  install(binding: unknown | undefined): void;
  version: 1;
}

/**
 * Defines the http adapter realtime capability type.
 */
export type HttpAdapterRealtimeCapability =
  | ServerBackedHttpAdapterRealtimeCapability
  | FetchStyleHttpAdapterRealtimeCapability
  | UnsupportedHttpAdapterRealtimeCapability;

/**
 * Create server backed http adapter realtime capability.
 *
 * @param server The server.
 * @returns The create server backed http adapter realtime capability result.
 */
export function createServerBackedHttpAdapterRealtimeCapability(
  server: unknown,
): ServerBackedHttpAdapterRealtimeCapability {
  return {
    kind: 'server-backed',
    server,
  };
}

/**
 * Create unsupported http adapter realtime capability.
 *
 * @param reason The reason.
 * @returns The create unsupported http adapter realtime capability result.
 */
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
 * Create fetch style http adapter realtime capability.
 *
 * @param reason The reason.
 * @param options The options.
 * @returns The create fetch style http adapter realtime capability result.
 */
export function createFetchStyleHttpAdapterRealtimeCapability(
  reason: string,
  options: {
    bindingInstallation?: Omit<HttpAdapterRealtimeBindingInstallation, 'version'>;
    support?: FetchStyleHttpAdapterRealtimeCapability['support'];
  } = {},
): FetchStyleHttpAdapterRealtimeCapability {
  const capability: FetchStyleHttpAdapterRealtimeCapability = {
    contract: 'raw-websocket-expansion',
    kind: 'fetch-style',
    mode: 'request-upgrade',
    reason,
    support: options.support ?? 'contract-only',
    version: 1,
  };

  if (options.bindingInstallation === undefined) {
    return capability;
  }

  return {
    ...capability,
    bindingInstallation: {
      install: options.bindingInstallation.install,
      version: 1,
    },
  };
}

/**
 * Validates and returns the versioned fetch-style realtime binding installation capability.
 *
 * @param capability Untrusted realtime capability returned by an HTTP adapter boundary.
 * @returns The callable version-1 binding installer.
 * @throws {TypeError} When the capability does not expose the versioned fetch-style installer contract.
 */
export function resolveFetchStyleHttpAdapterRealtimeBindingInstallation(
  capability: unknown,
): HttpAdapterRealtimeBindingInstallation {
  if (typeof capability !== 'object' || capability === null) {
    throw new TypeError('Expected a fetch-style realtime binding installation capability.');
  }

  const candidate = capability as Partial<FetchStyleHttpAdapterRealtimeCapability>;

  if (
    candidate.kind !== 'fetch-style'
    || candidate.contract !== 'raw-websocket-expansion'
    || candidate.mode !== 'request-upgrade'
    || candidate.support !== 'supported'
    || candidate.version !== 1
    || typeof candidate.reason !== 'string'
  ) {
    throw new TypeError('Expected a supported version-1 fetch-style realtime binding installation capability.');
  }

  const installation = candidate.bindingInstallation;

  if (
    typeof installation !== 'object'
    || installation === null
    || installation.version !== 1
    || typeof installation.install !== 'function'
  ) {
    throw new TypeError('Expected a callable version-1 fetch-style realtime binding installation.');
  }

  return installation;
}

/**
 * Minimal HTTP adapter contract that binds the application lifecycle to a transport implementation.
 */
export interface HttpApplicationAdapter {
  /**
   * Describes an activated listener for application startup logging.
   * Hosts without a socket or public listener URL may omit this capability.
   *
   * @returns The public URL and bound address after listen completes.
   */
  getListenTarget?(): { bindTarget: string; url: string };

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
   * @param dispatcher Dispatcher created by `@fluojs/http` that executes the request pipeline.
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
