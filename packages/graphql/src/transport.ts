import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';

interface NodeWritableResponse {
  end(chunk?: unknown): void;
  flushHeaders?: () => void;
  once(event: 'drain', listener: () => void): this;
  writableEnded?: boolean;
  write(chunk: unknown): boolean;
}

export function isGraphqlPath(path: string): boolean {
  return path === '/graphql' || path === '/graphql/';
}

function resolveAbsoluteRequestUrl(request: FrameworkRequest): string {
  const hostHeader = request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const protoHeader = request.headers['x-forwarded-proto'];
  const protoValue = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const proto = typeof protoValue === 'string' && protoValue.length > 0 ? protoValue : 'http';
  const base = `${proto}://${host ?? 'localhost'}`;

  return new URL(request.url || request.path || '/graphql', base).toString();
}

function createFetchHeaders(request: FrameworkRequest): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(name, value);
    }
  }

  return headers;
}

function createFetchBody(request: FrameworkRequest, headers: Headers): BodyInit | undefined {
  const method = request.method.toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  if (request.rawBody) {
    return Buffer.from(request.rawBody);
  }

  if (request.body === undefined) {
    return undefined;
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  if (request.body instanceof Uint8Array) {
    return Buffer.from(request.body);
  }

  if (request.body instanceof ArrayBuffer) {
    return Buffer.from(request.body);
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }

  return JSON.stringify(request.body);
}

export function toFetchRequest(request: FrameworkRequest): Request {
  const headers = createFetchHeaders(request);
  const body = createFetchBody(request, headers);

  return new Request(resolveAbsoluteRequestUrl(request), {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  });
}

function isNodeWritableResponse(raw: unknown): raw is NodeWritableResponse {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }

  const candidate = raw as {
    end?: unknown;
    once?: unknown;
    write?: unknown;
  };

  return typeof candidate.write === 'function' && typeof candidate.end === 'function' && typeof candidate.once === 'function';
}

export async function writeFetchResponse(fetchResponse: Response, frameworkResponse: FrameworkResponse): Promise<void> {
  frameworkResponse.setStatus(fetchResponse.status);

  for (const [name, value] of fetchResponse.headers.entries()) {
    frameworkResponse.setHeader(name, value);
  }

  const raw = frameworkResponse.raw;

  if (fetchResponse.body && isNodeWritableResponse(raw)) {
    frameworkResponse.committed = true;
    raw.flushHeaders?.();

    const reader = fetchResponse.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (raw.writableEnded) {
        break;
      }

      const canContinue = raw.write(Buffer.from(value));

      if (!canContinue && !raw.writableEnded) {
        await new Promise<void>((resolve) => {
          raw.once('drain', () => resolve());
        });
      }
    }

    if (!raw.writableEnded) {
      raw.end();
    }

    return;
  }

  const buffer = await fetchResponse.arrayBuffer();

  await frameworkResponse.send(new Uint8Array(buffer));
}
