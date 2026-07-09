import { Module } from '@fluojs/core';
import { type FrameworkRequest, type FrameworkResponse, Header, HttpCode } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { type ReactReadableStreamRenderer, type ReactRenderContext, renderReactResponse } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

const TEXT_DECODER = new TextDecoder();

type BufferedResponse = FrameworkResponse & {
  readonly chunks: readonly string[];
};

type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createBufferedResponse(): BufferedResponse {
  const chunks: string[] = [];

  return {
    committed: false,
    get chunks() {
      return chunks;
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

describe('React SSR buffered error handling', () => {
  it('does not leak success metadata when buffered React stream reading fails before send', async () => {
    class BufferedReactStreamError extends Error {
      readonly name = 'BufferedReactStreamError';

      constructor() {
        super('Buffered React stream failed before send.');
      }
    }

    const streamError = new BufferedReactStreamError();
    const renderToReadableStream: ReactReadableStreamRenderer = async () => new ReadableStream<Uint8Array>({
      pull() {
        throw streamError;
      },
    });
    const entry: ReactServerEntry = {
      assetMap: {},
      bootstrapModules: [],
      bootstrapScripts: [],
      headers: { 'x-react-entry': 'buffered' },
      node: createElement('main', null, 'Buffered dashboard'),
    };

    Object.defineProperty(entry, Symbol.for('fluo.http.responseWriter'), {
      enumerable: false,
      value: async (context: ReactResponseWriterContext): Promise<void> => {
        await renderReactResponse(entry, context.requestContext, {
          applySuccessResponseMetadata: context.applySuccessResponseMetadata,
          renderToReadableStream,
        });
      },
    });

    @Router('/buffered-broken')
    class BufferedBrokenRouter {
      @Header('x-react-route', 'buffered')
      @HttpCode(206)
      @Path('/')
      show() {
        return entry;
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [BufferedBrokenRouter],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const response = createBufferedResponse();

      await app.dispatch(createRequest('/buffered-broken'), response);

      expect(response.statusCode).toBe(500);
      expect(response.headers['Content-Type']).toBeUndefined();
      expect(response.headers['x-react-route']).toBeUndefined();
      expect(response.headers['x-react-entry']).toBeUndefined();
      expect(response.chunks.join('')).toContain('INTERNAL_SERVER_ERROR');
    } finally {
      await app.close();
    }
  });
});
