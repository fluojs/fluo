import { Module } from '@fluojs/core';
import type { FrameworkRequest, FrameworkResponse, FrameworkResponseStream } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { type ReactReadableStreamRenderer, type ReactRenderContext, renderReactResponse } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

type TestResponse = FrameworkResponse & { body?: unknown };

type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

function createRequest(signal: AbortSignal): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/aborted',
    query: {},
    raw: {},
    signal,
    url: '/aborted',
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
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

function createStreamingResponse(onWrite: () => void): FrameworkResponse {
  let closed = false;
  const stream: FrameworkResponseStream = {
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    write() {
      onWrite();
      return true;
    },
  };

  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    stream,
  };
}

describe('React SSR abort diagnostics', () => {
  it('reports request abort separately without committing a buffered response', async () => {
    const abortController = new AbortController();
    const diagnostics: Array<{ readonly code: string; readonly phase: string }> = [];
    const renderToReadableStream: ReactReadableStreamRenderer = async () => {
      abortController.abort();
      return new ReadableStream<Uint8Array>();
    };
    const entry: ReactServerEntry = {
      assetMap: {},
      bootstrapModules: [],
      bootstrapScripts: [],
      headers: {},
      node: createElement('main', null, 'Aborted'),
    };

    Object.defineProperty(entry, Symbol.for('fluo.react.serverEntry'), { value: true });
    Object.defineProperty(entry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value: async (context: ReactResponseWriterContext): Promise<void> => {
        await renderReactResponse(entry, context.requestContext, {
          applySuccessResponseMetadata: context.applySuccessResponseMetadata,
          renderToReadableStream,
        });
      },
    });

    @Router('/aborted')
    class AbortedRouter {
      @Path('/')
      show() {
        return entry;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [AbortedRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push({ code: diagnostic.code, phase: diagnostic.phase });
        },
      })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: the active request aborts after React starts shell rendering.
      const response = createResponse();

      // When: the dispatcher finalizes the explicit React server entry.
      await app.dispatch(createRequest(abortController.signal), response);

      // Then: no response is committed and diagnostics identify the abort phase.
      expect(response.committed).toBe(false);
      expect(response.body).toBeUndefined();
      expect(diagnostics).toEqual([{
        code: 'react-ssr-request-abort',
        phase: 'request-abort',
      }]);
    } finally {
      await app.close();
    }
  });

  it('reports request abort after a committed stream resolves its abort lifecycle', async () => {
    const abortController = new AbortController();
    const diagnostics: Array<{ readonly code: string; readonly phase: string }> = [];
    const renderToReadableStream: ReactReadableStreamRenderer = async () => new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('<main>partial</main>'));
      },
    });
    const entry: ReactServerEntry = {
      assetMap: {},
      bootstrapModules: [],
      bootstrapScripts: [],
      headers: {},
      node: createElement('main', null, 'Streaming abort'),
    };

    Object.defineProperty(entry, Symbol.for('fluo.react.serverEntry'), { value: true });
    Object.defineProperty(entry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value: async (context: ReactResponseWriterContext): Promise<void> => {
        await renderReactResponse(entry, context.requestContext, {
          applySuccessResponseMetadata: context.applySuccessResponseMetadata,
          renderToReadableStream,
        });
      },
    });

    @Router('/aborted')
    class AbortedRouter {
      @Path('/')
      show() {
        return entry;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [AbortedRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push({ code: diagnostic.code, phase: diagnostic.phase });
        },
      })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a streaming React response aborts after its first committed chunk.
      const response = createStreamingResponse(() => abortController.abort());

      // When: the committed stream completes its existing abort cleanup path.
      await app.dispatch(createRequest(abortController.signal), response);

      // Then: dispatch still resolves and diagnostics identify the request-abort phase.
      expect(response.committed).toBe(true);
      expect(diagnostics).toEqual([{
        code: 'react-ssr-request-abort',
        phase: 'request-abort',
      }]);
    } finally {
      await app.close();
    }
  });
});
