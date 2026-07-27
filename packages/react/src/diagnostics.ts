import { FluoError } from '@fluojs/core';
import type { FrameworkRequest } from '@fluojs/http';

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

function isDiagnosticMarkerKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function markReactSsrDiagnostic(
  error: unknown,
  marker: ReactSsrDiagnosticMarker,
): void {
  if (isDiagnosticMarkerKey(error)) {
    diagnosticMarkers.set(error, marker);
  }
}

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
