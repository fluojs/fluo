import type { HandlerDescriptor, RequestObserver } from '@fluojs/http';

import type { BootstrapTimingDiagnostics } from '../health/diagnostics.js';
import type { BootstrapApplicationOptions, CompiledModule, CreateApplicationContextOptions, ModuleType } from '../types.js';
import type { StudioLiveEvent, StudioLiveEventSource, StudioLiveSnapshot } from './contracts.js';
import { createStudioLiveSnapshot } from './snapshot.js';
import { StudioRequestObserver } from './studio-request-observer.js';
import { captureStudioDevtoolsConfig, type StudioDevtoolsConfig } from './studio-runtime-config.js';

export type { StudioDevtoolsConfig } from './studio-runtime-config.js';

const runtimePerformance = globalThis.performance ?? { now: () => Date.now() };
const processStart = runtimePerformance.now();

/**
 * Describes Studio Devtools Runtime Transport data used by the Studio devtool.
 */
export interface StudioDevtoolsRuntimeTransport {
  publish(event: StudioLiveEvent): Promise<void> | void;
}

/**
 * Describes Studio Devtools Runtime Options data used by the Studio devtool.
 */
export interface StudioDevtoolsRuntimeOptions {
  appId: string;
  epoch?: string;
  runtime?: StudioLiveEventSource['runtime'];
  transport: StudioDevtoolsRuntimeTransport;
}

/**
 * Describes Studio Bootstrap Snapshot Input data used by the Studio devtool.
 */
export interface StudioBootstrapSnapshotInput {
  diagnostics?: StudioLiveSnapshot['diagnostics'];
  modules: readonly CompiledModule[];
  rootModule: ModuleType;
  routes?: readonly HandlerDescriptor[];
  timing?: BootstrapTimingDiagnostics;
}

function createEpoch(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `epoch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createAppId(): string {
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

class FetchStudioTransport implements StudioDevtoolsRuntimeTransport {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async publish(event: StudioLiveEvent): Promise<void> {
    await globalThis.fetch(this.endpoint, {
      body: JSON.stringify(event),
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }
}

/** Process-local runtime bridge used only when Studio env injection is present. */
export class StudioDevtoolsRuntime {
  private readonly epoch: string;
  private readonly observer = new StudioRequestObserver(this);
  private sequence = 0;

  constructor(private readonly options: StudioDevtoolsRuntimeOptions) {
    this.epoch = options.epoch ?? createEpoch();
  }

  get appId(): string {
    return this.options.appId;
  }

  get requestObserver(): RequestObserver {
    return this.observer;
  }

  publish<TEvent extends StudioLiveEvent>(type: TEvent['type'], payload: TEvent['payload']): void {
    this.sequence += 1;
    const event = {
      emittedAt: new Date().toISOString(),
      epoch: this.epoch,
      eventId: `${this.epoch}:${String(this.sequence)}`,
      payload,
      sequence: this.sequence,
      source: {
        appId: this.options.appId,
        runtime: this.options.runtime ?? 'node',
      },
      type,
      version: 1 as const,
    } as StudioLiveEvent;

    void Promise.resolve(this.options.transport.publish(event)).catch(() => undefined);
  }

  publishBootstrapSnapshot(input: StudioBootstrapSnapshotInput): void {
    const snapshot = createStudioLiveSnapshot({
      appId: this.options.appId,
      diagnostics: input.diagnostics,
      modules: input.modules,
      rootModule: input.rootModule,
      routes: input.routes,
      timing: input.timing,
    });

    if (input.timing) {
      this.publish('timing', input.timing);
    }

    this.publish('snapshot', snapshot);
  }

  close(): void {
    this.publish('heartbeat', {
      uptimeMs: Number((runtimePerformance.now() - processStart).toFixed(3)),
    });
  }
}

/**
 * Creates the Studio runtime bridge from explicit CLI-injected config.
 * Returns `undefined` unless Studio is explicitly enabled and a token-protected endpoint is present.
 *
 * @param config Explicit Studio config injected by the application boundary.
 * @returns Studio runtime bridge, or `undefined` when Studio is disabled or incomplete.
 */
export function createStudioDevtoolsRuntimeFromConfig(config?: StudioDevtoolsConfig): StudioDevtoolsRuntime | undefined {
  const snapshot = captureStudioDevtoolsConfig(config);
  if (!snapshot || typeof globalThis.fetch !== 'function') {
    return undefined;
  }

  const epoch = snapshot.epoch ?? createEpoch();
  return new StudioDevtoolsRuntime({
    appId: snapshot.appId ?? createAppId(),
    epoch,
    runtime: snapshot.runtime,
    transport: new FetchStudioTransport(snapshot.endpoint, snapshot.token),
  });
}

/**
 * Compatibility helper for callers that already resolved env values at their application boundary.
 *
 * @param env Explicit Studio config resolved outside runtime package source.
 * @returns Studio runtime bridge, or `undefined` when Studio is disabled or incomplete.
 */
export function createStudioDevtoolsRuntimeFromEnv(env: StudioDevtoolsConfig): StudioDevtoolsRuntime | undefined {
  return createStudioDevtoolsRuntimeFromConfig(env);
}

/**
 * Provides apply Studio Devtools Application Options behavior for the Studio devtool.
 *
 * @param options options value used by apply Studio Devtools Application Options.
 * @param runtime runtime value used by apply Studio Devtools Application Options.
 * @returns The apply Studio Devtools Application Options result.
 */
export function applyStudioDevtoolsApplicationOptions(
  options: BootstrapApplicationOptions,
  runtime: StudioDevtoolsRuntime | undefined,
): BootstrapApplicationOptions {
  if (!runtime) {
    return options;
  }

  return {
    ...options,
    diagnostics: {
      ...options.diagnostics,
      timing: true,
    },
    observers: [...(options.observers ?? []), runtime.requestObserver],
  };
}

/**
 * Provides apply Studio Devtools Context Options behavior for the Studio devtool.
 *
 * @param options options value used by apply Studio Devtools Context Options.
 * @param runtime runtime value used by apply Studio Devtools Context Options.
 * @returns The apply Studio Devtools Context Options result.
 */
export function applyStudioDevtoolsContextOptions(
  options: CreateApplicationContextOptions,
  runtime: StudioDevtoolsRuntime | undefined,
): CreateApplicationContextOptions {
  if (!runtime) {
    return options;
  }

  return {
    ...options,
    diagnostics: {
      ...options.diagnostics,
      timing: true,
    },
  };
}

/**
 * Provides publish Studio Bootstrap Snapshot behavior for the Studio devtool.
 *
 * @param runtime runtime value used by publish Studio Bootstrap Snapshot.
 * @param input input value used by publish Studio Bootstrap Snapshot.
 */
export function publishStudioBootstrapSnapshot(
  runtime: StudioDevtoolsRuntime | undefined,
  input: StudioBootstrapSnapshotInput,
): void {
  runtime?.publishBootstrapSnapshot(input);
}
