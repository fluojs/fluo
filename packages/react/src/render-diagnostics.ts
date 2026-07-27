import { RequestAbortedError } from '@fluojs/http';

import {
  REACT_SSR_DIAGNOSTIC_CODES,
  REACT_SSR_DIAGNOSTIC_PHASES,
  ReactSsrDiagnosticError,
  createReactSsrDiagnostic,
  markReactSsrDiagnostic,
  reportReactSsrDiagnostic,
} from './diagnostics.js';
import type { ReactRenderContext } from './render.js';
import {
  readReactSsrDiagnosticHandler,
  type ReactRecoverableErrorContext,
  type ReactServerEntry,
} from './server-entry.js';

/** Recoverable React render error retained until the response shell can commit. */
export type PendingReactRecoverableError = {
  /** Original recoverable render failure. */
  readonly error: unknown;
  /** React-provided metadata, when available. */
  readonly errorInfo?: unknown;
};

type ReactRenderDiagnostics = {
  readonly preservePreCommitShellError: (error: unknown) => unknown;
  readonly reportRecoverableError: (event: PendingReactRecoverableError) => void;
  readonly reportRecoverableErrors: (events: readonly PendingReactRecoverableError[]) => void;
};

function createRecoverableErrorContext(
  errorInfo: unknown,
  requestContext: ReactRenderContext,
): ReactRecoverableErrorContext {
  return {
    code: REACT_SSR_DIAGNOSTIC_CODES.postShellRecoverableError,
    ...(errorInfo !== undefined ? { errorInfo } : {}),
    phase: REACT_SSR_DIAGNOSTIC_PHASES.postShellRecoverable,
    request: requestContext.request,
    ...(requestContext.requestId !== undefined ? { requestId: requestContext.requestId } : {}),
  };
}

function isDiagnosticMarkerKey(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Creates request-local reporting helpers for one React server entry render.
 *
 * @param entry React server entry whose callbacks receive recoverable errors.
 * @param requestContext Active request and response lifecycle context.
 * @returns Helpers that classify pre-commit failures and report recoverable errors.
 */
export function createReactRenderDiagnostics(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
): ReactRenderDiagnostics {
  const reportRecoverableError = (event: PendingReactRecoverableError): void => {
    const recoverableContext = createRecoverableErrorContext(event.errorInfo, requestContext);
    reportReactSsrDiagnostic(
      readReactSsrDiagnosticHandler(entry),
      createReactSsrDiagnostic({
        code: recoverableContext.code,
        error: event.error,
        phase: recoverableContext.phase,
        request: requestContext.request,
        ...(requestContext.requestId === undefined ? {} : { requestId: requestContext.requestId }),
      }),
    );
    const hook = entry.onRecoverableError;

    if (!hook) {
      return;
    }

    try {
      hook(event.error, recoverableContext);
    } catch (error) {
      if (error instanceof Error) {
        return;
      }
    }
  };

  return {
    preservePreCommitShellError(error) {
      if (
        error instanceof RequestAbortedError
        || error instanceof ReactSsrDiagnosticError
        || requestContext.response.committed
      ) {
        return error;
      }

      if (!isDiagnosticMarkerKey(error)) {
        return new ReactSsrDiagnosticError(
          'React SSR failed before the response shell committed.',
          {
            cause: error,
            code: REACT_SSR_DIAGNOSTIC_CODES.preCommitShellFailure,
            phase: REACT_SSR_DIAGNOSTIC_PHASES.preCommitShell,
          },
        );
      }

      markReactSsrDiagnostic(error, {
        code: REACT_SSR_DIAGNOSTIC_CODES.preCommitShellFailure,
        error,
        phase: REACT_SSR_DIAGNOSTIC_PHASES.preCommitShell,
      });
      return error;
    },
    reportRecoverableError,
    reportRecoverableErrors(events) {
      for (const event of events) {
        reportRecoverableError(event);
      }
    },
  };
}
