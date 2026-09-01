import { resolveHttpConnection, type ResolveHttpConnectionOptions } from './connection.js';
import type {
  FrameworkRequest,
  RequestContext,
  RequestObservationContext,
  RequestObserver,
} from './types.js';

const REDACTED_HEADER_VALUE = '[REDACTED]';
const DEFAULT_REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);

/** Structured lifecycle event emitted by {@link createAccessLogObserver}. */
export type AccessLogEvent =
  | AccessLogStartEvent
  | AccessLogErrorEvent
  | AccessLogFinishEvent;

/** A non-terminal access log record emitted when dispatch begins. */
export interface AccessLogStartEvent extends AccessLogRequestFields {
  readonly event: 'http.access.start';
}

/** A non-terminal access log record emitted when request dispatch fails. */
export interface AccessLogErrorEvent extends AccessLogRequestFields {
  readonly errorName: string;
  readonly event: 'http.access.error';
}

/** Terminal access log record emitted exactly once after request dispatch settles. */
export interface AccessLogFinishEvent extends AccessLogRequestFields {
  readonly durationMs: number;
  readonly event: 'http.access.finish';
  readonly outcome: AccessLogOutcome;
  readonly responseHeaders?: Readonly<Record<string, string | readonly string[]>>;
  readonly status?: number;
}

/** Common request fields carried by every structured access log event. */
export interface AccessLogRequestFields {
  readonly clientAddress?: string;
  readonly matchedRoute?: string;
  readonly method: string;
  readonly path: string;
  readonly requestHeaders?: Readonly<Record<string, string | readonly string[]>>;
  readonly requestId?: string;
}

/** Terminal request result classified from the observed dispatch lifecycle. */
export type AccessLogOutcome =
  | 'aborted'
  | 'handled_error'
  | 'not_found'
  | 'success'
  | 'unhandled_error';

/** Consumer-owned structured event sink used by an access log observer. */
export interface AccessLogSink {
  /**
   * Receives one immutable access log lifecycle event.
   *
   * @param event Structured request lifecycle data with only allowlisted headers.
   */
  emit(event: AccessLogEvent): void;
}

/** Header policy applied independently to request and response access log fields. */
export interface AccessLogHeaderOptions {
  /** Header names to include. The default empty allowlist emits no headers. */
  readonly allow?: readonly string[];
  /** Additional header names whose values must be redacted when allowlisted. */
  readonly redact?: readonly string[];
}

/** Options used to create a structured HTTP access log observer. */
export interface CreateAccessLogObserverOptions {
  /**
   * Explicit connection trust policy used to include a client address.
   *
   * Omit this option to keep transport and forwarded identity out of access logs.
   */
  readonly clientIdentity?: ResolveHttpConnectionOptions;
  /** Monotonic clock used to calculate terminal duration. Defaults to `performance.now()`. */
  readonly clock?: () => number;
  /** Allowlist and redaction policy for request and response headers. */
  readonly headers?: AccessLogHeaderOptions;
  /** Consumer-owned structured event destination. */
  readonly sink: AccessLogSink;
}

interface AccessLogState {
  readonly clientAddress?: string;
  error?: unknown;
  matchedRoute?: string;
  readonly request: FrameworkRequest;
  readonly requestHeaders?: Readonly<Record<string, string | readonly string[]>>;
  readonly startedAt: number;
}

function normalizeHeaderName(name: string): string {
  return name.toLowerCase();
}

function createHeaderPolicy(options: AccessLogHeaderOptions | undefined): {
  readonly allowed: ReadonlySet<string>;
  readonly redacted: ReadonlySet<string>;
} {
  const allowed = new Set((options?.allow ?? []).map(normalizeHeaderName));
  const redacted = new Set(DEFAULT_REDACTED_HEADERS);

  for (const header of options?.redact ?? []) {
    redacted.add(normalizeHeaderName(header));
  }

  return { allowed, redacted };
}

function collectAllowedHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  policy: { readonly allowed: ReadonlySet<string>; readonly redacted: ReadonlySet<string> },
): Readonly<Record<string, string | readonly string[]>> | undefined {
  const selected: Record<string, string | readonly string[]> = {};

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = normalizeHeaderName(name);

    if (value === undefined || !policy.allowed.has(normalizedName)) {
      continue;
    }

    selected[normalizedName] = policy.redacted.has(normalizedName)
      ? REDACTED_HEADER_VALUE
      : Array.isArray(value)
        ? Object.freeze([...value])
        : value;
  }

  return Object.keys(selected).length === 0 ? undefined : Object.freeze(selected);
}

function requestFields(state: AccessLogState): AccessLogRequestFields {
  return {
    ...(state.clientAddress === undefined ? {} : { clientAddress: state.clientAddress }),
    ...(state.matchedRoute === undefined ? {} : { matchedRoute: state.matchedRoute }),
    method: state.request.method,
    path: state.request.path,
    ...(state.requestHeaders === undefined ? {} : { requestHeaders: state.requestHeaders }),
    ...(state.request.requestId === undefined ? {} : { requestId: state.request.requestId }),
  };
}

function readErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function isRequestAborted(request: FrameworkRequest): boolean {
  return request.signal?.aborted === true || request.isAborted?.() === true;
}

function resolveOutcome(state: AccessLogState, context: RequestObservationContext): AccessLogOutcome {
  if (isRequestAborted(state.request)) {
    return 'aborted';
  }

  if (state.error === undefined) {
    return 'success';
  }

  if (state.matchedRoute === undefined && context.requestContext.response.statusCode === 404) {
    return 'not_found';
  }

  return (context.requestContext.response.statusCode ?? 500) < 500
    ? 'handled_error'
    : 'unhandled_error';
}

/**
 * Create a request observer that emits safe, structured access log lifecycle events.
 *
 * @param options Structured sink, optional client identity policy, header policy, and monotonic clock.
 * @returns A request observer suitable for `CreateDispatcherOptions.observers`.
 *
 * @remarks
 * The observer emits one start record, zero or more error records, and exactly one
 * terminal finish record per admitted request. Header values are never emitted unless
 * allowlisted, and authorization and cookie fields remain redacted even when allowed.
 */
export function createAccessLogObserver(options: CreateAccessLogObserverOptions): RequestObserver {
  const headerPolicy = createHeaderPolicy(options.headers);
  const clock = options.clock ?? performance.now.bind(performance);
  const states = new WeakMap<RequestContext, AccessLogState>();

  return {
    onHandlerMatched(context) {
      const state = states.get(context.requestContext);

      if (state) {
        state.matchedRoute = context.handler?.route.path;
      }
    },
    onRequestError(context, error) {
      const state = states.get(context.requestContext);

      if (!state) {
        return;
      }

      state.error = error;
      options.sink.emit({
        ...requestFields(state),
        errorName: readErrorName(error),
        event: 'http.access.error',
      });
    },
    onRequestFinish(context) {
      const state = states.get(context.requestContext);

      if (!state) {
        return;
      }

      states.delete(context.requestContext);
      const responseHeaders = collectAllowedHeaders(context.requestContext.response.headers, headerPolicy);

      options.sink.emit({
        ...requestFields(state),
        durationMs: Math.max(0, clock() - state.startedAt),
        event: 'http.access.finish',
        outcome: resolveOutcome(state, context),
        ...(responseHeaders === undefined ? {} : { responseHeaders }),
        ...(context.requestContext.response.statusCode === undefined
          ? {}
          : { status: context.requestContext.response.statusCode }),
      });
    },
    onRequestStart(context) {
      const requestHeaders = collectAllowedHeaders(context.requestContext.request.headers, headerPolicy);
      const clientAddress = options.clientIdentity === undefined
        ? undefined
        : resolveHttpConnection(context.requestContext.request, options.clientIdentity).clientAddress;
      const state: AccessLogState = {
        ...(clientAddress === undefined ? {} : { clientAddress }),
        request: context.requestContext.request,
        ...(requestHeaders === undefined ? {} : { requestHeaders }),
        startedAt: clock(),
      };

      states.set(context.requestContext, state);
      options.sink.emit({
        ...requestFields(state),
        event: 'http.access.start',
      });
    },
  };
}
