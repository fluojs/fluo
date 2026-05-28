import type { HandlerDescriptor, RequestObservationContext, RequestObserver } from '@fluojs/http';

import type { BootstrapTimingDiagnostics } from '../health/diagnostics.js';
import type { BootstrapApplicationOptions, CompiledModule, CreateApplicationContextOptions, ModuleType } from '../types.js';
import type { StudioLiveEvent, StudioLiveEventSource, StudioLiveSnapshot, StudioRequestTrace } from './contracts.js';
import { createStudioLiveSnapshot, handlerToStudioRouteDescriptor } from './snapshot.js';

const runtimePerformance = globalThis.performance;
const processStart = runtimePerformance.now();

export interface StudioDevtoolsRuntimeTransport {
  publish(event: StudioLiveEvent): Promise<void> | void;
}

export interface StudioDevtoolsRuntimeOptions {
  appId: string;
  epoch?: string;
  runtime?: StudioLiveEventSource['runtime'];
  transport: StudioDevtoolsRuntimeTransport;
}

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

interface StudioDevtoolsEnv {
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
  return `app-${typeof process !== 'undefined' ? process.pid : 'unknown'}-${Date.now().toString(36)}`;
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

function resolveEndpoint(env: StudioDevtoolsEnv): string | undefined {
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
      url: request.url,
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
      url: request.url,
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

/**
 * Creates the Studio runtime bridge from CLI-injected environment variables.
 * Returns `undefined` unless Studio is explicitly enabled and a token-protected endpoint is present.
 */
export function createStudioDevtoolsRuntimeFromEnv(env: StudioDevtoolsEnv = process.env): StudioDevtoolsRuntime | undefined {
  if (!isEnabled(env.FLUO_STUDIO)) {
    return undefined;
  }

  const endpoint = resolveEndpoint(env);
  if (!endpoint || !env.FLUO_STUDIO_TOKEN || typeof globalThis.fetch !== 'function') {
    return undefined;
  }

  const epoch = env.FLUO_STUDIO_EPOCH ?? createEpoch();
  return new StudioDevtoolsRuntime({
    appId: env.FLUO_STUDIO_APP_ID ?? createAppId(),
    epoch,
    runtime: normalizeRuntime(env.FLUO_STUDIO_RUNTIME),
    transport: new FetchStudioTransport(endpoint, env.FLUO_STUDIO_TOKEN),
  });
}

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

export function publishStudioBootstrapSnapshot(
  runtime: StudioDevtoolsRuntime | undefined,
  input: StudioBootstrapSnapshotInput,
): void {
  runtime?.publishBootstrapSnapshot(input);
}
