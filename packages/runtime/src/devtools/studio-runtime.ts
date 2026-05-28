import type { HandlerDescriptor, RequestObservationContext, RequestObserver } from '@fluojs/http';

import type { BootstrapTimingDiagnostics } from '../health/diagnostics.js';
import type { BootstrapApplicationOptions, CompiledModule, CreateApplicationContextOptions, ModuleType } from '../types.js';
import type { StudioLiveEvent, StudioLiveEventSource, StudioLiveSnapshot, StudioRequestTrace } from './contracts.js';
import { createStudioLiveSnapshot, handlerToStudioRouteDescriptor } from './snapshot.js';

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

interface MutableTrace {
  error?: StudioRequestTrace['error'];
  handler?: HandlerDescriptor;
  method: string;
  path: string;
  requestId: string;
  startedAt: string;
  startMs: number;
  status: StudioRequestTrace['status'];
  url: string;
}

/**
 * Describes Studio Devtools Config data used by the Studio devtool.
 */
export interface StudioDevtoolsConfig {
  FLUO_STUDIO?: string;
  FLUO_STUDIO_APP_ID?: string;
  FLUO_STUDIO_ENDPOINT?: string;
  FLUO_STUDIO_EPOCH?: string;
  FLUO_STUDIO_RUNTIME?: string;
  FLUO_STUDIO_TOKEN?: string;
  FLUO_STUDIO_URL?: string;
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
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

function createRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeRuntime(value: string | undefined): StudioLiveEventSource['runtime'] {
  if (value === 'node' || value === 'bun' || value === 'deno' || value === 'worker') {
    return value;
  }

  return 'node';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveEndpoint(env: StudioDevtoolsConfig): string | undefined {
  if (env.FLUO_STUDIO_ENDPOINT) {
    return env.FLUO_STUDIO_ENDPOINT;
  }

  if (!env.FLUO_STUDIO_URL) {
    return undefined;
  }

  try {
    return new URL('/api/runtime/events', env.FLUO_STUDIO_URL).toString();
  } catch {
    return undefined;
  }
}

function toErrorPayload(error: unknown): StudioRequestTrace['error'] {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}

function sanitizeRequestUrl(value: string): string {
  try {
    const parsed = new URL(value, 'http://fluo.local');
    return parsed.pathname || '/';
  } catch {
    return value.split('#', 1)[0]?.split('?', 1)[0] || value;
  }
}

function traceToPayload(trace: MutableTrace, statusCode?: number): StudioRequestTrace {
  const payload: StudioRequestTrace = {
    method: trace.method,
    path: trace.path,
    requestId: trace.requestId,
    startedAt: trace.startedAt,
    status: trace.status,
    url: trace.url,
  };

  if (trace.handler) {
    const route = handlerToStudioRouteDescriptor(trace.handler);
    payload.controller = route.controller;
    payload.handler = route.handler;
    payload.routeId = route.id;
  }

  if (trace.error) {
    payload.error = trace.error;
  }

  if (statusCode !== undefined) {
    payload.statusCode = statusCode;
  }

  if (trace.status === 'succeeded' || trace.status === 'failed' || trace.status === 'finished') {
    payload.finishedAt = new Date().toISOString();
    payload.durationMs = Number((runtimePerformance.now() - trace.startMs).toFixed(3));
  }

  return payload;
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

class StudioRequestObserver implements RequestObserver {
  private readonly traces = new WeakMap<object, MutableTrace>();

  constructor(private readonly runtime: StudioDevtoolsRuntime) {}

  onRequestStart(context: RequestObservationContext): void {
    const request = context.requestContext.request;
    const requestId = request.requestId
      ?? (typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : undefined)
      ?? createRequestId();
    const trace: MutableTrace = {
      method: request.method,
      path: request.path,
      requestId,
      startedAt: new Date().toISOString(),
      startMs: runtimePerformance.now(),
      status: 'started',
      url: sanitizeRequestUrl(request.url),
    };

    this.traces.set(context.requestContext, trace);
    this.runtime.publish('request', traceToPayload(trace));
  }

  onHandlerMatched(context: RequestObservationContext): void {
    const trace = this.ensureTrace(context);
    trace.handler = context.handler;
    trace.status = 'matched';
    this.runtime.publish('request', traceToPayload(trace));
  }

  onRequestSuccess(context: RequestObservationContext): void {
    const trace = this.ensureTrace(context);
    trace.handler = context.handler ?? trace.handler;
    trace.status = 'succeeded';
  }

  onRequestError(context: RequestObservationContext, error: unknown): void {
    const trace = this.ensureTrace(context);
    trace.handler = context.handler ?? trace.handler;
    trace.error = toErrorPayload(error);
    trace.status = 'failed';
    this.runtime.publish('request', traceToPayload(trace, context.requestContext.response.statusCode));
  }

  onRequestFinish(context: RequestObservationContext): void {
    const trace = this.ensureTrace(context);
    trace.handler = context.handler ?? trace.handler;
    if (trace.status !== 'failed' && trace.status !== 'succeeded') {
      trace.status = 'finished';
    }

    this.runtime.publish('request', traceToPayload(trace, context.requestContext.response.statusCode));
  }

  private ensureTrace(context: RequestObservationContext): MutableTrace {
    const existing = this.traces.get(context.requestContext);

    if (existing) {
      return existing;
    }

    const request = context.requestContext.request;
    const trace: MutableTrace = {
      method: request.method,
      path: request.path,
      requestId: request.requestId ?? createRequestId(),
      startedAt: new Date().toISOString(),
      startMs: runtimePerformance.now(),
      status: 'started',
      url: sanitizeRequestUrl(request.url),
    };
    this.traces.set(context.requestContext, trace);
    return trace;
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

const STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY = '__FLUO_STUDIO_DEVTOOLS_CONFIG__';

declare global {
  // eslint-disable-next-line no-var
  var __FLUO_STUDIO_DEVTOOLS_CONFIG__: StudioDevtoolsConfig | undefined;
}

function isStudioDevtoolsConfig(value: unknown): value is StudioDevtoolsConfig {
  if (!isRecord(value)) {
    return false;
  }

  return value.FLUO_STUDIO === undefined || typeof value.FLUO_STUDIO === 'string';
}

function readInjectedStudioDevtoolsConfig(): StudioDevtoolsConfig | undefined {
  const value = globalThis[STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY as keyof typeof globalThis];
  return isStudioDevtoolsConfig(value) ? value : undefined;
}

/**
 * Creates the Studio runtime bridge from explicit CLI-injected config.
 * Returns `undefined` unless Studio is explicitly enabled and a token-protected endpoint is present.
 *
 * @param config Explicit Studio config injected by the application boundary.
 * @returns Studio runtime bridge, or `undefined` when Studio is disabled or incomplete.
 */
export function createStudioDevtoolsRuntimeFromConfig(config: StudioDevtoolsConfig | undefined = readInjectedStudioDevtoolsConfig()): StudioDevtoolsRuntime | undefined {
  if (!config || !isEnabled(config.FLUO_STUDIO)) {
    return undefined;
  }

  const endpoint = resolveEndpoint(config);
  if (!endpoint || !config.FLUO_STUDIO_TOKEN || typeof globalThis.fetch !== 'function') {
    return undefined;
  }

  const epoch = config.FLUO_STUDIO_EPOCH ?? createEpoch();
  return new StudioDevtoolsRuntime({
    appId: config.FLUO_STUDIO_APP_ID ?? createAppId(),
    epoch,
    runtime: normalizeRuntime(config.FLUO_STUDIO_RUNTIME),
    transport: new FetchStudioTransport(endpoint, config.FLUO_STUDIO_TOKEN),
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
