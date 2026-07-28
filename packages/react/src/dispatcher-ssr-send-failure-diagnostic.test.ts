import { Module } from '@fluojs/core';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { type ReactReadableStreamRenderer, type ReactRenderContext, renderReactResponse } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

type SendFailureResponse = FrameworkResponse & {
  readonly body?: unknown;
  readonly sendAttempts: number;
};

function createRequest(): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/send-failure',
    query: {},
    raw: {},
    url: '/send-failure',
  };
}

function createSendFailureResponse(sendFailure: Error): SendFailureResponse {
  let body: unknown;
  let sendAttempts = 0;

  return {
    get body() {
      return body;
    },
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(nextBody: unknown) {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        throw sendFailure;
      }

      body = nextBody;
      this.committed = true;
    },
    get sendAttempts() {
      return sendAttempts;
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

describe('React SSR response-writer diagnostics', () => {
  it('classifies an uncommitted response send failure as an HTTP pipeline failure', async () => {
    const diagnostics: Array<{ readonly code: string; readonly phase: string }> = [];
    const sendFailure = new Error('Buffered response send failed.');
    const renderToReadableStream: ReactReadableStreamRenderer = async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<main>Ready</main>'));
        controller.close();
      },
    });
    const entry: ReactServerEntry = {
      assetMap: {},
      bootstrapModules: [],
      bootstrapScripts: [],
      headers: {},
      node: createElement('main', null, 'Ready'),
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

    @Router('/send-failure')
    class SendFailureRouter {
      @Path('/')
      show() {
        return entry;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [SendFailureRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push({ code: diagnostic.code, phase: diagnostic.phase });
        },
      })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: React produces a complete buffered shell before the response writer runs.
      const response = createSendFailureResponse(sendFailure);

      // When: the first uncommitted response send fails and the HTTP error writer recovers.
      await app.dispatch(createRequest(), response);

      // Then: diagnostics identify the HTTP pipeline rather than the React shell phase.
      expect(response.committed).toBe(true);
      expect(response.sendAttempts).toBe(2);
      expect(diagnostics).toEqual([{
        code: 'react-ssr-http-pipeline-failure',
        phase: 'http-pipeline',
      }]);
    } finally {
      await app.close();
    }
  });
});
