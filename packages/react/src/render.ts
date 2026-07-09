import type { FrameworkResponseStream, RequestContext } from '@fluojs/http';
import type { ReactNode } from 'react';

import type { ReactRecoverableErrorContext, ReactServerEntry } from './server-entry.js';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/** Readable stream returned by React's Web Streams SSR renderer. */
export type ReactReadableStream = ReadableStream<Uint8Array> & {
  /** Promise exposed by React for callers that intentionally wait for all Suspense boundaries. */
  readonly allReady?: Promise<void>;
};

/** React Web Streams render options used by `renderReactResponse(...)`. */
export type ReactReadableStreamRenderOptions = {
  /** Reports render errors observed by React during shell or Suspense streaming. */
  readonly onError?: (error: unknown, errorInfo?: unknown) => void;
  /** Abort signal propagated from the active fluo request when the adapter provides one. */
  readonly signal?: AbortSignal;
};

/** Function compatible with `react-dom/server` `renderToReadableStream`. */
export type ReactReadableStreamRenderer = (
  node: ReactNode,
  options: ReactReadableStreamRenderOptions,
) => Promise<ReactReadableStream>;

/** Options for rendering a React entry into one fluo response. */
export type RenderReactResponseOptions = {
  /** Test or custom renderer override. Defaults to lazy `react-dom/server` Web Streams rendering. */
  readonly renderToReadableStream?: ReactReadableStreamRenderer;
};

/** Minimal fluo request context needed to render one React HTML response. */
export type ReactRenderContext = Pick<RequestContext, 'request' | 'requestId' | 'response'>;

type PendingRecoverableError = {
  readonly error: unknown;
  readonly errorInfo?: unknown;
};

type AbortWait = {
  readonly cleanup: () => void;
  readonly promise: Promise<'aborted'>;
};

function createAbortWait(signal: AbortSignal | undefined): AbortWait | undefined {
  if (!signal) {
    return undefined;
  }

  if (signal.aborted) {
    return {
      cleanup: () => undefined,
      promise: Promise.resolve('aborted'),
    };
  }

  let listener: (() => void) | undefined;
  const promise = new Promise<'aborted'>((resolve) => {
    listener = () => resolve('aborted');
    signal.addEventListener('abort', listener, { once: true });
  });

  return {
    cleanup: () => {
      if (listener) {
        signal.removeEventListener('abort', listener);
      }
    },
    promise,
  };
}

async function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array> | 'aborted'> {
  const abort = createAbortWait(signal);

  if (!abort) {
    return reader.read();
  }

  try {
    return await Promise.race([reader.read(), abort.promise]);
  } finally {
    abort.cleanup();
  }
}

function applyEntryHeaders(entry: ReactServerEntry, requestContext: ReactRenderContext): void {
  for (const [name, value] of Object.entries(entry.headers)) {
    requestContext.response.setHeader(name, typeof value === 'string' ? value : [...value]);
  }

  requestContext.response.setHeader('Content-Type', HTML_CONTENT_TYPE);
}

function applyEntryStatus(entry: ReactServerEntry, requestContext: ReactRenderContext): void {
  if (entry.status !== undefined) {
    requestContext.response.setStatus(entry.status);
    return;
  }

  if (requestContext.response.statusSet !== true) {
    requestContext.response.setStatus(200);
  }
}

function createRecoverableErrorContext(
  errorInfo: unknown,
  requestContext: ReactRenderContext,
): ReactRecoverableErrorContext {
  return {
    ...(errorInfo !== undefined ? { errorInfo } : {}),
    request: requestContext.request,
    ...(requestContext.requestId !== undefined ? { requestId: requestContext.requestId } : {}),
  };
}

function reportRecoverableError(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  event: PendingRecoverableError,
): void {
  entry.onRecoverableError?.(event.error, createRecoverableErrorContext(event.errorInfo, requestContext));
}

function reportRecoverableErrors(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  events: readonly PendingRecoverableError[],
): void {
  for (const event of events) {
    reportRecoverableError(entry, requestContext, event);
  }
}

async function collectReadableStream(
  stream: ReactReadableStream,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (signal?.aborted !== true) {
      const next = await readNextChunk(reader, signal);

      if (next === 'aborted') {
        break;
      }

      if (next.done) {
        break;
      }

      chunks.push(next.value);
      byteLength += next.value.byteLength;
    }

    if (signal?.aborted === true) {
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function pipeReadableStream(
  stream: ReactReadableStream,
  target: FrameworkResponseStream,
  signal: AbortSignal | undefined,
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (signal?.aborted !== true && !target.closed) {
      const next = await readNextChunk(reader, signal);

      if (next === 'aborted') {
        break;
      }

      if (next.done) {
        break;
      }

      const accepted = target.write(next.value);

      if (!accepted) {
        await target.waitForDrain?.();
      }
    }

    if (signal?.aborted === true) {
      await reader.cancel();
    }
  } finally {
    reader.releaseLock();

    if (!target.closed) {
      target.close();
    }
  }
}

async function writeReactStream(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  stream: ReactReadableStream,
  pendingRecoverableErrors: readonly PendingRecoverableError[],
): Promise<void> {
  const responseStream = requestContext.response.stream;

  if (!responseStream) {
    const body = await collectReadableStream(stream, requestContext.request.signal);
    reportRecoverableErrors(entry, requestContext, pendingRecoverableErrors);
    await requestContext.response.send(body);
    return;
  }

  requestContext.response.committed = true;
  responseStream.flush?.();
  reportRecoverableErrors(entry, requestContext, pendingRecoverableErrors);
  await pipeReadableStream(stream, responseStream, requestContext.request.signal);
}

async function defaultRenderToReadableStream(
  node: ReactNode,
  options: ReactReadableStreamRenderOptions,
): Promise<ReactReadableStream> {
  const { renderToReadableStream } = await import('react-dom/server');

  return renderToReadableStream(node, options);
}

/**
 * Renders a React server entry to one fluo HTML response using Web Streams SSR.
 *
 * @param entry React server entry created by `createReactServerEntry(...)`.
 * @param requestContext Active fluo request context whose response receives the HTML stream.
 * @param options Optional custom renderer, primarily for tests and custom React DOM integration.
 * @returns A promise that resolves when the shell stream has been fully piped or the request aborts.
 * @throws Shell render errors before any response bytes are committed.
 */
export async function renderReactResponse(
  entry: ReactServerEntry,
  requestContext: ReactRenderContext,
  options: RenderReactResponseOptions = {},
): Promise<void> {
  const renderToReadableStream = options.renderToReadableStream ?? defaultRenderToReadableStream;
  const pendingRecoverableErrors: PendingRecoverableError[] = [];
  let shellReady = false;
  const stream = await renderToReadableStream(entry.node, {
    ...(requestContext.request.signal !== undefined ? { signal: requestContext.request.signal } : {}),
    onError(error, errorInfo) {
      const event = errorInfo !== undefined ? { error, errorInfo } : { error };

      if (shellReady) {
        reportRecoverableError(entry, requestContext, event);
        return;
      }

      pendingRecoverableErrors.push(event);
    },
  });

  shellReady = true;
  applyEntryStatus(entry, requestContext);
  applyEntryHeaders(entry, requestContext);
  await writeReactStream(entry, requestContext, stream, pendingRecoverableErrors);
}
