import type { RequestObservationContext, RequestObserver } from '@fluojs/http';

import type { StudioRequestTrace } from './contracts.js';
import { handlerToStudioRouteDescriptor } from './snapshot.js';
import type { StudioDevtoolsRuntime } from './studio-runtime.js';

const runtimePerformance = globalThis.performance ?? { now: () => Date.now() };

interface MutableTrace {
  error?: StudioRequestTrace['error'];
  handler?: RequestObservationContext['handler'];
  method: string;
  path: string;
  requestId: string;
  startedAt: string;
  startMs: number;
  status: StudioRequestTrace['status'];
  url: string;
}

function createRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

export class StudioRequestObserver implements RequestObserver {
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
