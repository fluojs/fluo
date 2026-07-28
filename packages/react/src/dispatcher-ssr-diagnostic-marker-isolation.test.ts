import { Module } from '@fluojs/core';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import type { ReactSsrDiagnostic, ReactSsrDiagnosticHandler } from './diagnostics.js';
import { ReactModule } from './module.js';
import { type ReactReadableStreamRenderer, type ReactRenderContext, renderReactResponse } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

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

function createResponse(): FrameworkResponse {
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
  };
}

function createFailingEntry(
  renderToReadableStream: ReactReadableStreamRenderer,
  beforeFailureRethrow?: () => Promise<void>,
): ReactServerEntry {
  const entry: ReactServerEntry = {
    assetMap: {},
    bootstrapModules: [],
    bootstrapScripts: [],
    headers: {},
    node: createElement('main', null, 'Diagnostic marker isolation'),
  };

  Object.defineProperty(entry, Symbol.for('fluo.react.serverEntry'), { value: true });
  Object.defineProperty(entry, Symbol.for('fluo.http.responseWriter'), {
    enumerable: false,
    value: async (context: ReactResponseWriterContext): Promise<void> => {
      try {
        await renderReactResponse(entry, context.requestContext, {
          applySuccessResponseMetadata: context.applySuccessResponseMetadata,
          renderToReadableStream,
        });
      } catch (error) {
        await beforeFailureRethrow?.();
        throw error;
      }
    },
  });

  return entry;
}

function createAppModule(
  path: string,
  entry: ReactServerEntry,
  onDiagnostic: ReactSsrDiagnosticHandler,
) {
  @Router(path)
  class MarkerRouter {
    @Path('/')
    show() {
      return entry;
    }
  }

  @Module({
    imports: [ReactModule.forRoot({ controllers: [MarkerRouter], onDiagnostic })],
  })
  class AppModule {}

  return AppModule;
}

describe('React SSR diagnostic marker isolation', () => {
  it('keeps shell markers request-local when concurrent requests throw the same Error', async () => {
    const sharedError = new Error('Shared concurrent shell failure.');
    const firstDiagnostics: ReactSsrDiagnostic[] = [];
    const secondDiagnostics: ReactSsrDiagnostic[] = [];
    let failedRenderCount = 0;
    let releaseFailures = (): void => {};
    const bothRendersFailed = new Promise<void>((resolve) => {
      releaseFailures = resolve;
    });
    const beforeFailureRethrow = async (): Promise<void> => {
      failedRenderCount += 1;
      if (failedRenderCount === 2) {
        releaseFailures();
      }
      await bothRendersFailed;
    };
    const entry = createFailingEntry(async () => {
      throw sharedError;
    }, beforeFailureRethrow);
    const firstApp = await bootstrapApplication({
      rootModule: createAppModule('/first', entry, (diagnostic) => firstDiagnostics.push(diagnostic)),
    });
    const secondApp = await bootstrapApplication({
      rootModule: createAppModule('/second', entry, (diagnostic) => secondDiagnostics.push(diagnostic)),
    });

    try {
      // Given: two shell renders fail with the same Error before either failure reaches its request boundary.
      const firstDispatch = firstApp.dispatch(createRequest('/first'), createResponse());
      const secondDispatch = secondApp.dispatch(createRequest('/second'), createResponse());

      // When: both request boundaries classify their retained shell failure.
      await Promise.all([firstDispatch, secondDispatch]);

      // Then: each request reports its own shell marker and preserves the shared Error identity.
      expect(firstDiagnostics).toHaveLength(1);
      expect(secondDiagnostics).toHaveLength(1);
      expect(firstDiagnostics[0]).toMatchObject({
        code: 'react-ssr-pre-commit-shell-failure',
        phase: 'pre-commit-shell',
        request: { url: '/first' },
      });
      expect(secondDiagnostics[0]).toMatchObject({
        code: 'react-ssr-pre-commit-shell-failure',
        phase: 'pre-commit-shell',
        request: { url: '/second' },
      });
      expect(firstDiagnostics[0]?.error).toBe(sharedError);
      expect(secondDiagnostics[0]?.error).toBe(sharedError);
    } finally {
      await Promise.all([firstApp.close(), secondApp.close()]);
    }
  });

});
