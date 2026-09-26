import {
  type FrameworkResponseValueFinalizerContext,
  registerFrameworkResponseValueFinalizer,
  registerFrameworkResponseWriter,
} from '@fluojs/http/internal';
import {
  isRequestAbortedError,
  type Middleware,
  type MiddlewareContext,
  type Next,
  type RequestContext,
} from '@fluojs/http/portable';
import { isValidElement } from 'react';

import { getReactPathMetadata } from './decorators.js';
import {
  bindReactSsrDiagnosticHandler,
  createReactSsrDiagnostic,
  isReactSsrDiagnosticError,
  REACT_SSR_DIAGNOSTIC_CODES,
  REACT_SSR_DIAGNOSTIC_PHASES,
  ReactSsrDiagnosticError,
  type ReactSsrDiagnosticHandler,
  readReactSsrDiagnosticMarker,
  reportReactSsrDiagnostic,
} from './diagnostics.js';
import type { ReactPageRenderer } from './page-renderer.js';
import { isReactNavigationPage, type ReactNavigationPayload } from './navigation-payload.js';
import { getReactRenderPolicies } from './render-policy.js';
import { isReactServerEntry } from './server-entry.js';

type ReactPageResultRuntime = {
  readonly onDiagnostic?: ReactSsrDiagnosticHandler;
  readonly renderPage?: ReactPageRenderer;
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

  if (isReactSsrDiagnosticError(error)) {
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

  if (isRequestAbortedError(error) || isRequestAborted(context)) {
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
  context: FrameworkResponseValueFinalizerContext,
): unknown {
  if (getReactPathMetadata(context.handler.controllerToken, context.handler.methodName) === undefined) {
    return context.value;
  }

  if (isReactNavigationPage(context.value)) {
    if (runtime.renderPage === undefined) {
      throw new ReactSsrDiagnosticError(
        'A @Path handler returned a React page, but ReactModule.forRoot(...) has no renderPage callback. '
        + 'Configure renderPage or return createReactServerEntry(...) explicitly.',
        {
          code: REACT_SSR_DIAGNOSTIC_CODES.missingPageRenderer,
          phase: REACT_SSR_DIAGNOSTIC_PHASES.httpPipeline,
        },
      );
    }
    const { node, destination } = context.value;
    const renderPage = runtime.renderPage;
    const page = registerFrameworkResponseWriter(
      { node, destination },
      async (writerContext) => {
        const entry = renderPage(
          node,
          writerContext.requestContext,
          getReactRenderPolicies(context.handler.controllerToken, context.handler.methodName),
        );
        const { renderReactResponse } = await import('./render.js');
        await renderReactResponse(entry, writerContext.requestContext, {
          applySuccessResponseMetadata: writerContext.applySuccessResponseMetadata,
        });
      },
    );
    Object.defineProperty(page, Symbol.for('fluo.http.responseRepresentation'), {
      enumerable: false,
      value: {
        mediaType: 'application/vnd.fluo.react-navigation+json;v=1',
        body: ({ request }: FrameworkResponseValueFinalizerContext): ReactNavigationPayload => ({
          version: 1,
          url: request.url,
          params: { ...request.params },
          destination: {
            module: destination.module,
            props: JSON.parse(JSON.stringify(destination.props)),
          },
        }),
      },
    });
    return page;
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
      registerFrameworkResponseValueFinalizer(
        context.requestContext,
        (finalizerContext): unknown => finalizeReactPageResult(runtime, finalizerContext),
      );
      try {
        await next();
      } catch (error) {
        reportReactPageFailure(runtime, error, context.requestContext);
        throw error;
      }
    },
  };
}
