import { Container } from '@fluojs/di';
import {
  createRequestContext,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  type RequestContext,
} from '@fluojs/http';
import { createElement, useId } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderReactResponse, type ReactReadableStreamRenderer } from './render.js';
import { createReactServerEntry, type ReactAssetMap } from './server-entry.js';

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

type CapturedResponse = FrameworkResponse & {
  readonly chunks: readonly string[];
  readonly closed: boolean;
};

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/dashboard',
    query: {},
    raw: {},
    url: '/dashboard',
  };
}

function createBufferedResponse(): CapturedResponse {
  const chunks: string[] = [];

  return {
    committed: false,
    get chunks() {
      return chunks;
    },
    get closed() {
      return false;
    },
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      if (body instanceof Uint8Array) {
        chunks.push(TEXT_DECODER.decode(body));
      } else if (typeof body === 'string') {
        chunks.push(body);
      } else if (body !== undefined) {
        chunks.push(JSON.stringify(body));
      }
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

function createStreamedResponse(): CapturedResponse {
  const chunks: string[] = [];
  let closed = false;

  const stream: FrameworkResponseStream = {
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    flush() {},
    waitForDrain() {
      return Promise.resolve();
    },
    write(chunk: string | Uint8Array) {
      chunks.push(typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true }));
      return true;
    },
  };

  return {
    ...createBufferedResponse(),
    get chunks() {
      return chunks;
    },
    get closed() {
      return closed;
    },
    send(body: unknown) {
      if (body instanceof Uint8Array) {
        chunks.push(TEXT_DECODER.decode(body));
      } else if (typeof body === 'string') {
        chunks.push(body);
      } else if (body !== undefined) {
        chunks.push(JSON.stringify(body));
      }
      this.committed = true;
    },
    stream,
  };
}

function createTestContext(response: FrameworkResponse): RequestContext {
  return createRequestContext({
    container: new Container(),
    metadata: {},
    request: createRequest(),
    response,
  });
}

function createReadableStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encodedChunks = chunks.map((chunk) => TEXT_ENCODER.encode(chunk));

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of encodedChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function IdentifierProbe() {
  const id = useId();

  return createElement('div', { id }, 'Hydrated');
}

describe('React hydration asset contract', () => {
  it('streams bootstrap scripts, modules, inline content, nonce, and identifier prefix through React DOM', async () => {
    const response = createStreamedResponse();
    const context = createTestContext(response);

    await renderReactResponse(
      createReactServerEntry(
        createElement('html', null, createElement('body', null, createElement(IdentifierProbe))),
        {
          bootstrapModules: ['/assets/dashboard.module.js'],
          bootstrapScriptContent: 'window.__FLUO_BOOTSTRAPPED__ = true;',
          bootstrapScripts: ['/assets/dashboard.js', '/assets/dashboard.js'],
          identifierPrefix: 'fluo-',
          nonce: 'nonce-123',
        },
      ),
      context,
    );

    const html = response.chunks.join('');

    expect(html).toContain('window.__FLUO_BOOTSTRAPPED__ = true;');
    expect(html).toContain('nonce="nonce-123"');
    expect(html).toMatch(/<script[^>]+src="\/assets\/dashboard\.js"/u);
    expect(html.match(/<script[^>]+src="\/assets\/dashboard\.js"/gu) ?? []).toHaveLength(1);
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\/dashboard\.module\.js"/u);
    expect(html).toContain('fluo-');
  });

  it('buffers hydration asset options and asset maps without implicit unsafe inline serialization', async () => {
    const response = createBufferedResponse();
    const context = createTestContext(response);
    const mutableAssetMap: Record<string, string> = {
      'main.js': '/assets/main.123.js',
      'styles.css': '/assets/styles.123.css',
    };
    let receivedAssetMap: ReactAssetMap | undefined;
    let receivedBootstrapScriptContent: string | undefined;
    let receivedBootstrapScripts: readonly unknown[] | undefined;
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async (_node, options) => {
      receivedAssetMap = options.assetMap;
      receivedBootstrapScriptContent = options.bootstrapScriptContent;
      receivedBootstrapScripts = options.bootstrapScripts;

      return createReadableStream(['<main data-client-entry="/assets/main.123.js">Assets</main>']);
    });

    const entry = createReactServerEntry(
      createElement('main', { 'data-client-entry': mutableAssetMap['main.js'] }, 'Assets'),
      {
        assetMap: mutableAssetMap,
        bootstrapScripts: [mutableAssetMap['main.js'], mutableAssetMap['main.js']],
      },
    );
    mutableAssetMap['main.js'] = '/assets/main.changed.js';

    await renderReactResponse(entry, context, { renderToReadableStream });

    expect(receivedAssetMap).toEqual({
      'main.js': '/assets/main.123.js',
      'styles.css': '/assets/styles.123.css',
    });
    expect(receivedBootstrapScripts).toEqual(['/assets/main.123.js']);
    expect(receivedBootstrapScriptContent).toBeUndefined();
    expect(response.chunks.join('')).not.toContain('window.');
    expect(response.chunks.join('')).toContain('/assets/main.123.js');
  });
});
