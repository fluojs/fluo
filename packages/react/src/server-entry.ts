import type { FrameworkRequest } from '@fluojs/http';
import type { ReactNode } from 'react';

import type { ReactRenderContext } from './render.js';

const responseWriterKey = Symbol.for('fluo.http.responseWriter');

type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

/** Header values applied before a React server entry starts streaming. */
export type ReactServerEntryHeaders = Readonly<Record<string, string | readonly string[]>>;

/** Recoverable React render error details reported after the shell can stream. */
export type ReactRecoverableErrorContext = {
  /** React-provided error metadata, such as a component stack, when available. */
  readonly errorInfo?: unknown;
  /** Framework request being rendered. */
  readonly request: FrameworkRequest;
  /** Adapter-provided request id, when available. */
  readonly requestId?: string;
};

/** Hook invoked when React reports a recoverable streaming render error. */
export type ReactRecoverableErrorHandler = (
  error: unknown,
  context: ReactRecoverableErrorContext,
) => void;

/** Options used to create a React server entry. */
export type ReactServerEntryOptions = {
  /** Additional response headers to apply before the HTML stream commits. */
  readonly headers?: ReactServerEntryHeaders;
  /** Hook for recoverable errors reported by React after the shell is ready. */
  readonly onRecoverableError?: ReactRecoverableErrorHandler;
  /** HTTP status to apply before streaming starts. Defaults to the current response status or `200`. */
  readonly status?: number;
};

/** Runtime-neutral React server entry rendered to streamed HTML by `renderReactResponse(...)`. */
export type ReactServerEntry = {
  /** Additional response headers to apply before the HTML stream commits. */
  readonly headers: ReactServerEntryHeaders;
  /** React tree rendered with `react-dom/server` Web Streams APIs. */
  readonly node: ReactNode;
  /** Hook for recoverable errors reported by React after the shell is ready. */
  readonly onRecoverableError?: ReactRecoverableErrorHandler;
  /** HTTP status to apply before streaming starts. Defaults to the current response status or `200`. */
  readonly status?: number;
};

function cloneHeaders(headers: ReactServerEntryHeaders | undefined): ReactServerEntryHeaders {
  const cloned: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    cloned[name] = typeof value === 'string' ? value : [...value];
  }

  return cloned;
}

/**
 * Creates a runtime-neutral React server entry for streamed HTML rendering.
 *
 * @param node React node tree returned by a page handler.
 * @param options Optional status, headers, and recoverable error hook for the render.
 * @returns A defensive React server entry snapshot suitable for `renderReactResponse(...)`.
 */
export function createReactServerEntry(
  node: ReactNode,
  options: ReactServerEntryOptions = {},
): ReactServerEntry {
  const entry: ReactServerEntry = {
    headers: cloneHeaders(options.headers),
    node,
    ...(options.onRecoverableError !== undefined ? { onRecoverableError: options.onRecoverableError } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
  };

  Object.defineProperty(entry, responseWriterKey, {
    enumerable: false,
    value: async (context: ReactResponseWriterContext): Promise<void> => {
      const { renderReactResponse } = await import('./render.js');
      await renderReactResponse(entry, context.requestContext, {
        applySuccessResponseMetadata: context.applySuccessResponseMetadata,
      });
    },
  });

  return entry;
}
