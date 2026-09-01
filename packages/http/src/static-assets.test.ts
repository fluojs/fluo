import { describe, expect, it, vi } from 'vitest';

import {
  createStaticAssetsMiddleware,
  type FrameworkRequest,
  type FrameworkResponse,
  type MiddlewareContext,
  type RequestContext,
  type StaticAsset,
  type StaticAssetSource,
} from './index.js';

type RecordedResponse = FrameworkResponse & {
  readonly sentBodies: unknown[];
};

function createRequest(
  path: string,
  headers: FrameworkRequest['headers'] = {},
  method = 'GET',
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): RecordedResponse {
  const sentBodies: unknown[] = [];

  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      sentBodies.push(body);
      this.committed = true;
    },
    sentBodies,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

async function invokeStaticMiddleware(
  middleware: ReturnType<typeof createStaticAssetsMiddleware>,
  request: FrameworkRequest,
): Promise<{ readonly next: ReturnType<typeof vi.fn>; readonly response: RecordedResponse }> {
  const response = createResponse();
  const next = vi.fn(async () => undefined);
  const context: MiddlewareContext = {
    request,
    requestContext: {
      container: {} as RequestContext['container'],
      metadata: {},
      request,
      response,
    },
    response,
  };

  await middleware.handle(context, next);
  return { next, response };
}

describe('static asset middleware', () => {
  it.each([
    '/assets/../secret.txt',
    '/assets/%2e%2e/secret.txt',
    '/assets/%2e%2e%2fsecret.txt',
    '/assets/%2e%2e%5csecret.txt',
    '/assets/%00secret.txt',
  ])('does not resolve traversal or malformed path %s', async (path) => {
    const resolve = vi.fn<StaticAssetSource['resolve']>();
    const middleware = createStaticAssetsMiddleware({
      prefix: '/assets',
      source: { resolve },
    });

    const { next, response } = await invokeStaticMiddleware(middleware, createRequest(path));

    expect(resolve).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(response.committed).toBe(false);
  });

  it('applies index and dotfile policy before resolving the source', async () => {
    const asset: StaticAsset = {
      contentType: 'application/javascript',
      source: Uint8Array.from([0, 1, 2, 3, 4, 5]),
      size: 6,
      validators: {
        etag: { opaqueValue: 'asset-v1', strength: 'strong' },
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
    };
    const resolve = vi.fn<StaticAssetSource['resolve']>(async (path) => {
      return path === 'docs/index.js' ? asset : undefined;
    });
    const middleware = createStaticAssetsMiddleware({
      cacheControl: 'public, max-age=300',
      index: ['index.js'],
      prefix: '/assets',
      source: { resolve },
    });

    const indexed = await invokeStaticMiddleware(middleware, createRequest('/assets/docs/'));
    const dotfile = await invokeStaticMiddleware(middleware, createRequest('/assets/.env'));

    expect(resolve.mock.calls.map(([path]) => path)).toEqual(['docs/index.js']);
    expect(indexed.response.statusCode).toBe(200);
    expect(indexed.response.headers['Content-Type']).toBe('application/javascript');
    expect(indexed.response.headers['Cache-Control']).toBe('public, max-age=300');
    expect(indexed.response.sentBodies).toEqual([Uint8Array.from([0, 1, 2, 3, 4, 5])]);
    expect(dotfile.next).toHaveBeenCalledOnce();
  });

  it('shares validators, conditional requests, ranges, and HEAD metadata', async () => {
    const asset: StaticAsset = {
      contentType: 'application/javascript',
      source: Uint8Array.from([0, 1, 2, 3, 4, 5]),
      size: 6,
      validators: {
        etag: { opaqueValue: 'asset-v1', strength: 'strong' },
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
    };
    let openedStreams = 0;
    const streamAsset: StaticAsset = {
      contentType: 'application/javascript',
      source: () => {
        openedStreams += 1;
        return new ReadableStream<Uint8Array>();
      },
      size: 6,
      validators: { etag: { opaqueValue: 'stream-v1', strength: 'strong' } },
    };
    const middleware = createStaticAssetsMiddleware({
      cacheControl: 'public, max-age=300',
      prefix: '/assets',
      source: {
        async resolve(path) {
          return path === 'stream.js' ? streamAsset : asset;
        },
      },
    });

    const range = await invokeStaticMiddleware(middleware, createRequest('/assets/app.js', {
      'if-range': '"asset-v1"',
      range: 'bytes=2-4',
    }));
    const notModified = await invokeStaticMiddleware(middleware, createRequest('/assets/app.js', {
      'if-none-match': '"asset-v1"',
    }));
    const head = await invokeStaticMiddleware(middleware, createRequest('/assets/stream.js', {}, 'HEAD'));

    expect(range.response.statusCode).toBe(206);
    expect(range.response.headers).toMatchObject({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
      'Content-Length': '3',
      'Content-Range': 'bytes 2-4/6',
      'Content-Type': 'application/javascript',
      ETag: '"asset-v1"',
      'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
    });
    expect(range.response.sentBodies).toEqual([Uint8Array.from([2, 3, 4])]);
    expect(notModified.response.statusCode).toBe(304);
    expect(notModified.response.headers).toMatchObject({
      'Cache-Control': 'public, max-age=300',
      ETag: '"asset-v1"',
      'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT',
    });
    expect(notModified.response.sentBodies).toEqual([undefined]);
    expect(head.response.statusCode).toBe(200);
    expect(head.response.headers).toMatchObject({
      'Content-Length': '6',
      ETag: '"stream-v1"',
    });
    expect(head.response.sentBodies).toEqual([undefined]);
    expect(openedStreams).toBe(0);
  });
});
