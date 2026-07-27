import { FluoError } from '@fluojs/core';
import type { FrameworkRequest, RequestContext } from '@fluojs/http';

/** Stable machine-readable phases for the React SSR request lifecycle. */
export const REACT_SSR_DIAGNOSTIC_PHASES = {
  httpPipeline: 'http-pipeline',
  postShellRecoverable: 'post-shell-recoverable',
  preCommitShell: 'pre-commit-shell',
  requestAbort: 'request-abort',
} as const;

/** Stable machine-readable codes emitted by React SSR diagnostics. */
export const REACT_SSR_DIAGNOSTIC_CODES = {
  httpPipelineFailure: 'react-ssr-http-pipeline-failure',
  missingPageRenderer: 'react-ssr-missing-page-renderer',
  postShellRecoverableError: 'react-ssr-post-shell-recoverable-error',
  preCommitShellFailure: 'react-ssr-pre-commit-shell-failure',
  requestAbort: 'react-ssr-request-abort',
} as const;

/** Machine-readable React SSR lifecycle phase. */
export type ReactSsrDiagnosticPhase =
  (typeof REACT_SSR_DIAGNOSTIC_PHASES)[keyof typeof REACT_SSR_DIAGNOSTIC_PHASES];

/** Machine-readable React SSR diagnostic code. */
export type ReactSsrDiagnosticCode =
  (typeof REACT_SSR_DIAGNOSTIC_CODES)[keyof typeof REACT_SSR_DIAGNOSTIC_CODES];

/** Structured diagnostic emitted while a React page request is processed. */
export type ReactSsrDiagnostic = {
  /** Stable machine-readable diagnostic code. */
  readonly code: ReactSsrDiagnosticCode;
  /** Original failure reported at this lifecycle boundary. */
  readonly error: unknown;
  /** Stable lifecycle phase associated with the failure. */
  readonly phase: ReactSsrDiagnosticPhase;
  /** Active framework request. */
  readonly request: FrameworkRequest;
  /** Adapter-provided request id, when available. */
  readonly requestId?: string;
};

/** Application callback for observing structured React SSR diagnostics. */
export type ReactSsrDiagnosticHandler = (diagnostic: ReactSsrDiagnostic) => void;

/** Options for creating a typed React SSR diagnostic error. */
export type ReactSsrDiagnosticErrorOptions = {
  /** Stable machine-readable diagnostic code. */
  readonly code: ReactSsrDiagnosticCode;
  /** Original failure, when one exists. */
  readonly cause?: unknown;
  /** Stable lifecycle phase associated with the failure. */
  readonly phase: ReactSsrDiagnosticPhase;
};

/** Typed React SSR failure carrying stable code and phase metadata. */
export class ReactSsrDiagnosticError extends FluoError {
  /** Stable machine-readable diagnostic code for this failure. */
  override readonly code: ReactSsrDiagnosticCode;
  /** Stable lifecycle phase associated with this failure. */
  readonly phase: ReactSsrDiagnosticPhase;

  /**
   * Creates a typed React SSR lifecycle failure.
   *
   * @param message Actionable human-readable failure description.
   * @param options Stable code, phase, and optional original failure.
   */
  constructor(
    message: string,
    options: ReactSsrDiagnosticErrorOptions,
  ) {
    super(message, {
      code: options.code,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
      meta: { phase: options.phase },
    });
    this.code = options.code;
    this.phase = options.phase;
  }
}

type ReactSsrDiagnosticMarker = {
  readonly code: ReactSsrDiagnosticCode;
  readonly error: unknown;
  readonly phase: ReactSsrDiagnosticPhase;
};

const diagnosticMarkers = new WeakMap<object, ReactSsrDiagnosticMarker>();
const diagnosticHandlerKey = Symbol.for('fluo.react.ssrDiagnosticHandler');

function isDiagnosticMarkerKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Stores the module diagnostic handler on the active request context.
 *
 * @param context Request context that owns the render lifecycle.
 * @param handler Module diagnostic handler, when configured.
 */
export function bindReactSsrDiagnosticHandler(
  context: RequestContext,
  handler: ReactSsrDiagnosticHandler | undefined,
): void {
  if (handler === undefined) {
    delete context.metadata[diagnosticHandlerKey];
    return;
  }

  context.metadata[diagnosticHandlerKey] = handler;
}

/**
 * Reads the module diagnostic handler from a render request context.
 *
 * @param context Render context that may carry request metadata.
 * @returns The request-local diagnostic handler, when one exists.
 */
export function readReactSsrDiagnosticHandler(
  context: object,
): ReactSsrDiagnosticHandler | undefined {
  const metadata: unknown = Reflect.get(context, 'metadata');
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }

  const handler: unknown = Reflect.get(metadata, diagnosticHandlerKey);
  if (typeof handler !== 'function') {
    return undefined;
  }

  return (diagnostic) => Reflect.apply(handler, undefined, [diagnostic]);
}

/**
 * Associates a diagnostic classification with an error without changing its identity.
 *
 * @param error Original lifecycle failure.
 * @param marker Stable code and phase retained for the request error boundary.
 */
export function markReactSsrDiagnostic(
  error: unknown,
  marker: ReactSsrDiagnosticMarker,
): void {
  if (isDiagnosticMarkerKey(error)) {
    diagnosticMarkers.set(error, marker);
  }
}

/**
 * Reads and consumes the diagnostic classification associated with an error.
 *
 * @param error Original lifecycle failure.
 * @returns The retained classification, when one exists.
 */
export function readReactSsrDiagnosticMarker(
  error: unknown,
): ReactSsrDiagnosticMarker | undefined {
  if (!isDiagnosticMarkerKey(error)) {
    return undefined;
  }

  const marker = diagnosticMarkers.get(error);
  diagnosticMarkers.delete(error);
  return marker;
}

/**
 * Creates a structured diagnostic snapshot for an SSR lifecycle event.
 *
 * @param diagnostic Diagnostic values observed at the active request boundary.
 * @returns A request-safe diagnostic object.
 */
export function createReactSsrDiagnostic(
  diagnostic: ReactSsrDiagnostic,
): ReactSsrDiagnostic {
  return {
    code: diagnostic.code,
    error: diagnostic.error,
    phase: diagnostic.phase,
    request: diagnostic.request,
    ...(diagnostic.requestId === undefined ? {} : { requestId: diagnostic.requestId }),
  };
}

/**
 * Reports an SSR diagnostic without allowing observer failures to replace the request outcome.
 *
 * @param handler Application diagnostic observer, when configured.
 * @param diagnostic Structured lifecycle event to report.
 */
export function reportReactSsrDiagnostic(
  handler: ReactSsrDiagnosticHandler | undefined,
  diagnostic: ReactSsrDiagnostic,
): void {
  if (handler === undefined) {
    return;
  }

  try {
    handler(diagnostic);
  } catch (error) {
    if (error instanceof Error) {
      return;
    }
  }
}
