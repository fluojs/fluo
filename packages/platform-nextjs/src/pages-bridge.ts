import type { Buffer } from 'node:buffer';
import { once } from 'node:events';
import type {
  Readable,
  Writable,
} from 'node:stream';
import { finished } from 'node:stream/promises';

import type { NextAdapterLoader, NextHttpApplicationAdapter } from './adapter.js';

interface NextPagesRequestSource extends Readable {
  readonly aborted?: boolean;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly method?: string;
  readonly url?: string;
}

interface NextPagesResponseTarget extends Writable {
  statusCode: number;
  statusMessage: string;
  setHeader(
    name: string,
    value: number | string | readonly string[],
  ): this;
}

type DuplexRequestInit = RequestInit & {
  readonly duplex: 'half';
};

function createRequestHeaders(
  source: NextPagesRequestSource['headers'],
): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      headers.set(name, value);
      continue;
    }

    for (const entry of value ?? []) {
      headers.append(name, entry);
    }
  }

  return headers;
}

function requestMethodHasBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

function createRequestBody(
  request: NextPagesRequestSource,
  signal: AbortSignal,
) {
  let pull = () => Promise.resolve();
  let dispose = (_cancelled = false) => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let pending: (() => void) | undefined;
      const finish = (error?: unknown, cancelled = false) => {
        if (stopped) {
          return;
        }
        stopped = true;
        request.off('readable', onReadable);
        request.off('end', onEnd);
        request.off('error', onError);
        signal.removeEventListener('abort', onAbort);
        // Next/Node owns socket disposal and draining after the response.
        // Cancelling body parsing must leave it alive to deliver errors (413).
        request.pause();
        if (!cancelled) {
          if (error === undefined) {
            controller.close();
          } else {
            controller.error(error);
          }
        }
        pending?.();
        pending = undefined;
      };
      const onEnd = () => finish();
      const onError = (error: Error) => finish(error);
      const onAbort = () => finish(signal.reason);
      const onReadable = () => {
        if (!pending || stopped) {
          return;
        }
        const chunk: Buffer | string | null = request.read();
        if (chunk !== null) {
          const resolve = pending;
          pending = undefined;
          request.off('readable', onReadable);
          controller.enqueue(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
          );
          resolve();
        } else if (request.readableEnded) {
          finish();
        }
      };

      dispose = (cancelled = false) => finish(undefined, cancelled);
      pull = () => new Promise<void>((resolve) => {
        pending = resolve;
        request.on('readable', onReadable);
        onReadable();
      });
      request.once('end', onEnd);
      request.once('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      } else if (request.readableEnded) {
        onEnd();
      }
    },
    pull() {
      return pull();
    },
    cancel() {
      dispose(true);
    },
  }, { highWaterMark: 0 });
  return { body, dispose: () => dispose() };
}

function createWebRequest(
  request: NextPagesRequestSource,
  signal: AbortSignal,
) {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', 'http://next.local');
  const headers = createRequestHeaders(request.headers);

  if (!requestMethodHasBody(method)) {
    return { request: new Request(url, { headers, method, signal }), dispose: () => {} };
  }

  const body = createRequestBody(request, signal);
  const init: DuplexRequestInit = {
    body: body.body,
    duplex: 'half',
    headers,
    method,
    signal,
  };

  return { request: new Request(url, init), dispose: body.dispose };
}

function writeResponseHeaders(
  source: Headers,
  target: NextPagesResponseTarget,
): void {
  const setCookies = source.getSetCookie();

  source.forEach((value, name) => {
    if (name !== 'set-cookie') {
      target.setHeader(name, value);
    }
  });

  if (setCookies.length > 0) {
    target.setHeader('set-cookie', setCookies);
  }
}

async function writeWebResponse(
  response: Response,
  target: NextPagesResponseTarget,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    await response.body?.cancel();
    return;
  }
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  writeResponseHeaders(response.headers, target);

  try {
    if (response.body) {
      const reader = response.body.getReader();
      // Cancel the Web reader directly: returning an async iterator cannot
      // interrupt its pending read, so Readable.from(...)/pipeline can hang.
      const onAbort = () => {
        void Promise.allSettled([reader.cancel(signal.reason)]);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done || signal.aborted) {
            break;
          }
          if (!target.write(value)) {
            await once(target, 'drain', { signal });
          }
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        try {
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    }
    if (signal.aborted) {
      return;
    }
    const completion = finished(target, { cleanup: true, readable: false, signal });
    target.end();
    await completion;
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}

/**
 * Dispatch one Pages Router request through the bound Fluo adapter and stream
 * the produced Web response back onto the Node.js API route target.
 *
 * @param adapter Bootstrapped adapter or its memoized lazy resolver.
 * @param request Native Next.js Pages Router request source.
 * @param response Native Next.js Pages Router response target.
 * @returns Resolves once the Web response has been fully streamed to `response`.
 */
export async function dispatchNextPagesRequest(
  adapter: NextHttpApplicationAdapter | NextAdapterLoader,
  request: NextPagesRequestSource,
  response: NextPagesResponseTarget,
): Promise<void> {
  const controller = new AbortController();
  let resolveDisconnected: () => void = () => undefined;
  const disconnected = new Promise<undefined>((resolve) => {
    resolveDisconnected = () => resolve(undefined);
  });
  const abort = () => {
    controller.abort();
    resolveDisconnected();
  };
  const onClose = () => {
    if (!response.writableFinished) {
      abort();
    }
  };
  request.once('aborted', abort);
  request.once('error', abort);
  response.once('close', onClose);
  response.once('error', abort);
  let webRequest: ReturnType<typeof createWebRequest> | undefined;
  try {
    if (request.aborted || (request.destroyed && !request.readableEnded)
      || response.destroyed || response.writableEnded) {
      return;
    }
    const resolvedAdapter = typeof adapter === 'function'
      ? await Promise.race([adapter(), disconnected])
      : adapter;
    if (!resolvedAdapter || controller.signal.aborted) {
      return;
    }
    webRequest = createWebRequest(request, controller.signal);
    const fetched = resolvedAdapter.fetch(webRequest.request).then(async (result) => {
      if (controller.signal.aborted) {
        await result.body?.cancel();
        return undefined;
      }
      return result;
    });
    const webResponse = await Promise.race([fetched, disconnected]);
    if (webResponse) {
      await writeWebResponse(webResponse, response, controller.signal);
    }
  } finally {
    webRequest?.dispose();
    request.off('aborted', abort);
    request.off('error', abort);
    response.off('close', onClose);
    response.off('error', abort);
    if (response.writableFinished && !request.destroyed) {
      // Discard any remaining upload only after the response has been sent.
      // No Web queue remains, and Next retains ownership of the live socket.
      request.resume();
    }
  }
}
