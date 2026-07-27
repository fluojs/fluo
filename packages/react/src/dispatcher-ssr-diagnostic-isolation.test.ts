import { Module } from '@fluojs/core';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import type { ReactSsrDiagnosticHandler } from './diagnostics.js';
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

function createSharedEntry(renderToReadableStream: ReactReadableStreamRenderer): ReactServerEntry {
  const entry: ReactServerEntry = {
    assetMap: {},
    bootstrapModules: [],
    bootstrapScripts: [],
    headers: {},
    node: createElement('main', null, 'Shared entry'),
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

  return entry;
}

function createAppModule(
  path: string,
  entry: ReactServerEntry,
  onDiagnostic?: ReactSsrDiagnosticHandler,
) {
  @Router(path)
  class SharedEntryRouter {
    @Path('/')
    show() {
      return entry;
    }
  }

  @Module({
    imports: [ReactModule.forRoot({
      controllers: [SharedEntryRouter],
      ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    })],
  })
  class AppModule {}

  return AppModule;
}

describe('React SSR diagnostic request isolation', () => {
  it('does not retain a diagnostic handler when a shared entry is reused sequentially', async () => {
    const firstDiagnostics: string[] = [];
    const recoverableError = new Error('Sequential recoverable render error.');
    const renderToReadableStream: ReactReadableStreamRenderer = async (_node, options) => {
      options.onError?.(recoverableError);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    };
    const entry = createSharedEntry(renderToReadableStream);
    const firstApp = await bootstrapApplication({
      rootModule: createAppModule('/first', entry, (diagnostic) => {
        firstDiagnostics.push(diagnostic.request.url);
      }),
    });
    const secondApp = await bootstrapApplication({
      rootModule: createAppModule('/second', entry),
    });

    try {
      // Given: one shared entry is first rendered by a module with diagnostics enabled.
      await firstApp.dispatch(createRequest('/first'), createResponse());

      // When: another module without a diagnostic handler reuses the same entry.
      await secondApp.dispatch(createRequest('/second'), createResponse());

      // Then: the first module observes only its own request.
      expect(firstDiagnostics).toEqual(['/first']);
    } finally {
      await Promise.all([firstApp.close(), secondApp.close()]);
    }
  });

  it('routes concurrent shared-entry diagnostics to each active request', async () => {
    const firstDiagnostics: string[] = [];
    const secondDiagnostics: string[] = [];
    let firstRenderStarted = (): void => {};
    const firstRender = new Promise<void>((resolve) => {
      firstRenderStarted = resolve;
    });
    let releaseFirstRender = (): void => {};
    const secondRender = new Promise<void>((resolve) => {
      releaseFirstRender = resolve;
    });
    let renderCount = 0;
    const renderToReadableStream: ReactReadableStreamRenderer = async (_node, options) => {
      renderCount += 1;
      const activeRender = renderCount;

      if (activeRender === 1) {
        firstRenderStarted();
        await secondRender;
      } else {
        releaseFirstRender();
      }

      options.onError?.(new Error(`Concurrent recoverable error ${activeRender}.`));
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    };
    const entry = createSharedEntry(renderToReadableStream);
    const firstApp = await bootstrapApplication({
      rootModule: createAppModule('/first', entry, (diagnostic) => {
        firstDiagnostics.push(diagnostic.request.url);
      }),
    });
    const secondApp = await bootstrapApplication({
      rootModule: createAppModule('/second', entry, (diagnostic) => {
        secondDiagnostics.push(diagnostic.request.url);
      }),
    });

    try {
      // Given: the first shared-entry render is paused after its request-local handler is selected.
      const firstDispatch = firstApp.dispatch(createRequest('/first'), createResponse());
      await firstRender;

      // When: a second request reuses the entry before either render reports its error.
      const secondDispatch = secondApp.dispatch(createRequest('/second'), createResponse());
      await Promise.all([firstDispatch, secondDispatch]);

      // Then: each module observes only the diagnostic from its own request.
      expect(firstDiagnostics).toEqual(['/first']);
      expect(secondDiagnostics).toEqual(['/second']);
    } finally {
      await Promise.all([firstApp.close(), secondApp.close()]);
    }
  });
});
