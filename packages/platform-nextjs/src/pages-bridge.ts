import type { Buffer } from 'node:buffer';
import {
  Readable,
  type Writable,
} from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { NextHttpApplicationAdapter } from './adapter.js';

interface NextPagesRequestSource extends Readable {
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
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const onData = (chunk: Buffer | string) => {
        controller.enqueue(
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : chunk,
        );
      };
      const cleanup = () => {
        request.off('data', onData);
        request.off('end', onEnd);
        request.off('error', onError);
      };
      const onEnd = () => {
        cleanup();
        controller.close();
      };
      const onError = (error: Error) => {
        cleanup();
        controller.error(error);
      };

      request.on('data', onData);
      request.once('end', onEnd);
      request.once('error', onError);
    },
    cancel() {
      request.destroy();
    },
  });
}

function createWebRequest(request: NextPagesRequestSource): Request {
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', 'http://next.local');
  const headers = createRequestHeaders(request.headers);

  if (!requestMethodHasBody(method)) {
    return new Request(url, { headers, method });
  }

  const init: DuplexRequestInit = {
    body: createRequestBody(request),
    duplex: 'half',
    headers,
    method,
  };

  return new Request(url, init);
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
): Promise<void> {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  writeResponseHeaders(response.headers, target);

  if (!response.body) {
    target.end();
    return;
  }

  await pipeline(Readable.from(response.body), target);
}

/**
 * Dispatch one Pages Router request through the bound Fluo adapter and stream
 * the produced Web response back onto the Node.js API route target.
 *
 * @param adapter Bootstrapped Next-hosted Fluo application adapter.
 * @param request Native Next.js Pages Router request source.
 * @param response Native Next.js Pages Router response target.
 * @returns Resolves once the Web response has been fully streamed to `response`.
 */
export async function dispatchNextPagesRequest(
  adapter: NextHttpApplicationAdapter,
  request: NextPagesRequestSource,
  response: NextPagesResponseTarget,
): Promise<void> {
  const webResponse = await adapter.fetch(createWebRequest(request));
  await writeWebResponse(webResponse, response);
}
