import {
  type HandlerDescriptor,
  type Middleware,
  type MiddlewareContext,
  type Next,
  RequestAbortedError,
  type RequestContext,
} from '@fluojs/http';
import { isValidElement } from 'react';

import { getReactPathMetadata } from './decorators.js';
import {
  bindReactSsrDiagnosticHandler,
  createReactSsrDiagnostic,
  REACT_SSR_DIAGNOSTIC_CODES,
  REACT_SSR_DIAGNOSTIC_PHASES,
  ReactSsrDiagnosticError,
  type ReactSsrDiagnosticHandler,
  readReactSsrDiagnosticMarker,
  reportReactSsrDiagnostic,
} from './diagnostics.js';
import type { ReactPageRenderer } from './page-renderer.js';
import { getReactRenderPolicies } from './render-policy.js';
import { isReactServerEntry } from './server-entry.js';

const responseValueFinalizerKey = Symbol.for('fluo.http.responseValueFinalizer');

type ReactPageResultRuntime = {
  readonly onDiagnostic?: ReactSsrDiagnosticHandler;
  readonly renderPage?: ReactPageRenderer;
};

type ReactPageResultFinalizerContext = {
  readonly handler: HandlerDescriptor;
  readonly requestContext: RequestContext;
  readonly value: unknown;
};

function isRequestAborted(context: RequestContext): boolean {
  return context.request.signal?.aborted === true || context.request.isAborted?.() === true;
}

function reportReactPageFailure(
  runtime: ReactPageResultRuntime,
  error: unknown,
  context: RequestContext,
): void {
  const marker = readReactSsrDiagnosticMarker(context, error);
  if (marker !== undefined) {
    reportReactSsrDiagnostic(
      runtime.onDiagnostic,
      createReactSsrDiagnostic({
        code: marker.code,
        error,
        phase: marker.phase,
        request: context.request,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      }),
    );
    return;
  }

  if (error instanceof ReactSsrDiagnosticError) {
    reportReactSsrDiagnostic(
      runtime.onDiagnostic,
      createReactSsrDiagnostic({
        code: error.code,
        error,
        phase: error.phase,
        request: context.request,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      }),
    );
    return;
  }

  if (error instanceof RequestAbortedError || isRequestAborted(context)) {
    reportReactSsrDiagnostic(
      runtime.onDiagnostic,
      createReactSsrDiagnostic({
        code: REACT_SSR_DIAGNOSTIC_CODES.requestAbort,
        error,
        phase: REACT_SSR_DIAGNOSTIC_PHASES.requestAbort,
        request: context.request,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      }),
    );
    return;
  }

  if (!context.response.committed) {
    reportReactSsrDiagnostic(
      runtime.onDiagnostic,
      createReactSsrDiagnostic({
        code: REACT_SSR_DIAGNOSTIC_CODES.httpPipelineFailure,
        error,
        phase: REACT_SSR_DIAGNOSTIC_PHASES.httpPipeline,
        request: context.request,
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      }),
    );
  }
}

function finalizeReactPageResult(
  runtime: ReactPageResultRuntime,
  context: ReactPageResultFinalizerContext,
): unknown {
  if (getReactPathMetadata(context.handler.controllerToken, context.handler.methodName) === undefined) {
    return context.value;
  }

  if (isReactServerEntry(context.value)) {
    return context.value;
  }

  if (!isValidElement(context.value)) {
    return context.value;
  }

  if (runtime.renderPage === undefined) {
    throw new ReactSsrDiagnosticError(
      'A @Path handler returned a ReactElement, but ReactModule.forRoot(...) has no renderPage callback. '
      + 'Configure renderPage or return createReactServerEntry(...) explicitly.',
      {
        code: REACT_SSR_DIAGNOSTIC_CODES.missingPageRenderer,
        phase: REACT_SSR_DIAGNOSTIC_PHASES.httpPipeline,
      },
    );
  }

  const policies = getReactRenderPolicies(
    context.handler.controllerToken,
    context.handler.methodName,
  );
  const entry = runtime.renderPage(context.value, context.requestContext, policies);
  return entry;
}

/**
 * Creates module middleware that finalizes React page values through the HTTP response lifecycle.
 *
 * @param runtime Module-level renderer and diagnostic configuration.
 * @returns Middleware that installs request-local React response state.
 */
export function createReactPageResultMiddleware(runtime: ReactPageResultRuntime): Middleware {
  return {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      bindReactSsrDiagnosticHandler(context.requestContext, runtime.onDiagnostic);
      context.requestContext.metadata[responseValueFinalizerKey] = (
        finalizerContext: ReactPageResultFinalizerContext,
      ): unknown => finalizeReactPageResult(runtime, finalizerContext);
      try {
        await next();
      } catch (error) {
        reportReactPageFailure(runtime, error, context.requestContext);
        throw error;
      }
    },
  };
}
