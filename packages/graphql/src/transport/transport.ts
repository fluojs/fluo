import type { FrameworkRequest, FrameworkResponse, FrameworkResponseStream } from '@fluojs/http';

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

function readSetCookieValues(headers: Headers): string[] {
  const setCookieHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof setCookieHeaders.getSetCookie === 'function') {
    return setCookieHeaders.getSetCookie();
  }

  const values: string[] = [];

  for (const [name, value] of headers.entries()) {
    if (name.toLowerCase() === 'set-cookie') {
      values.push(value);
    }
  }

  return values;
}

export async function writeFetchResponse(fetchResponse: Response, frameworkResponse: FrameworkResponse): Promise<void> {
  frameworkResponse.setStatus(fetchResponse.status);

  const setCookieValues = readSetCookieValues(fetchResponse.headers);

  for (const value of setCookieValues) {
    frameworkResponse.setHeader('set-cookie', value);
  }

  for (const [name, value] of fetchResponse.headers.entries()) {
    if (name.toLowerCase() === 'set-cookie') {
      continue;
    }

    frameworkResponse.setHeader(name, value);
  }

  const stream = frameworkResponse.stream;

  if (fetchResponse.body && stream) {
    frameworkResponse.committed = true;
    stream.flush?.();

    const reader = fetchResponse.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (stream.closed) {
        break;
      }

      const canContinue = stream.write(value);

      if (!canContinue && !stream.closed) {
        await stream.waitForDrain?.();
      }
    }

    if (!stream.closed) {
      stream.close();
    }

    return;
  }

  const buffer = await fetchResponse.arrayBuffer();

  await frameworkResponse.send(new Uint8Array(buffer));
}
