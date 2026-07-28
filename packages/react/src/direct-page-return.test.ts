import { Module } from '@fluojs/core';
import {
  type FrameworkRequest,
  type FrameworkResponse,
  Header,
  HttpCode,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import type { ReactPageRenderer } from './page-renderer.js';
import { createReactServerEntry } from './server-entry.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type ObservedDiagnostic = {
  readonly code: string;
  readonly phase: string;
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

function decodeBufferedBody(response: TestResponse): string {
  expect(response.body).toBeInstanceOf(Uint8Array);
  if (!(response.body instanceof Uint8Array)) {
    throw new TypeError('Expected the buffered React response to contain bytes.');
  }
  return new TextDecoder().decode(response.body);
}

describe('direct React page returns', () => {
  it('finalizes a ReactElement returned by a Path handler through the application page renderer', async () => {
    const renderedPages: string[] = [];
    const renderPage: ReactPageRenderer = (page, context) => {
      renderedPages.push(context.request.url);
      return createReactServerEntry(
        createElement('html', null, createElement('body', null, page)),
        { headers: { 'x-react-renderer': 'application' } },
      );
    };

    @Router('/products')
    class ProductRouter {
      @Header('x-react-route', 'product')
      @HttpCode(206)
      @Path('/:id')
      show(_input: undefined, context: { readonly request: FrameworkRequest }) {
        return createElement('main', null, `Product ${context.request.params.id ?? 'missing'}`);
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [ProductRouter], renderPage })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: an application page renderer is configured for a React router.
      const response = createResponse();

      // When: a @Path handler returns one valid ReactElement directly.
      await app.dispatch(createRequest('/products/42'), response);

      // Then: the renderer composes the element and the existing HTTP writer applies route metadata.
      expect(renderedPages).toEqual(['/products/42']);
      expect(response.statusCode).toBe(206);
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(response.headers['x-react-renderer']).toBe('application');
      expect(response.headers['x-react-route']).toBe('product');
      expect(decodeBufferedBody(response)).toContain('Product 42');
    } finally {
      await app.close();
    }
  });

  it('does not convert ordinary Path handler values into React responses', async () => {
    let rendererCalls = 0;
    const renderPage: ReactPageRenderer = (page) => {
      rendererCalls += 1;
      return createReactServerEntry(page);
    };

    @Router('/values')
    class ValueRouter {
      @Path('/object')
      object() {
        return { kind: 'object' };
      }

      @Path('/string')
      string() {
        return 'plain string';
      }

      @Path('/array')
      array() {
        return ['plain', 'array'];
      }

      @Path('/null')
      nullValue() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [ValueRouter], renderPage })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: ordinary values are returned from @Path handlers while renderPage is configured.
      const responses = [createResponse(), createResponse(), createResponse(), createResponse()];

      // When: the dispatcher writes each result through the normal HTTP response path.
      await Promise.all([
        app.dispatch(createRequest('/values/object'), responses[0]),
        app.dispatch(createRequest('/values/string'), responses[1]),
        app.dispatch(createRequest('/values/array'), responses[2]),
        app.dispatch(createRequest('/values/null'), responses[3]),
      ]);

      // Then: no ordinary value is treated as a ReactElement.
      expect(rendererCalls).toBe(0);
      expect(responses.map((response) => response.body)).toEqual([
        { kind: 'object' },
        'plain string',
        ['plain', 'array'],
        null,
      ]);
    } finally {
      await app.close();
    }
  });

  it('reports an actionable pre-commit diagnostic when renderPage is not configured', async () => {
    const diagnostics: ObservedDiagnostic[] = [];

    @Router('/missing-renderer')
    class MissingRendererRouter {
      @Path('/')
      show() {
        return createElement('main', null, 'Missing renderer');
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [MissingRendererRouter],
        onDiagnostic(diagnostic) {
          diagnostics.push({ code: diagnostic.code, phase: diagnostic.phase });
        },
      })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a @Path handler can return JSX but its React module has no renderPage callback.
      const response = createResponse();

      // When: the dispatcher reaches React page result finalization.
      await app.dispatch(createRequest('/missing-renderer'), response);

      // Then: the HTTP error path commits once and diagnostics identify the missing configuration.
      expect(response.statusCode).toBe(500);
      expect(response.headers['Content-Type']).toBeUndefined();
      expect(diagnostics).toEqual([{
        code: 'react-ssr-missing-page-renderer',
        phase: 'http-pipeline',
      }]);
    } finally {
      await app.close();
    }
  });
});
