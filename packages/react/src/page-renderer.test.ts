import { Inject, Module } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { REACT_PAGE_RENDERER, type ReactPageRenderer } from './page-renderer.js';
import type { ReactRenderContext } from './render.js';
import {
  PageLayout,
  type ReactPageLayout,
  type ReactSuspenseFallback,
  SuspenseFallback,
} from './render-policy.js';
import { createReactServerEntry } from './server-entry.js';

type TestResponse = FrameworkResponse & { body?: unknown };

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

describe('ReactPageRenderer', () => {
  it('registers one application renderPage callback that receives the active request context', async () => {
    const renderedRequests: Array<{
      readonly params: Readonly<Record<string, string>>;
      readonly url: string;
    }> = [];
    const applicationRenderPage: ReactPageRenderer = (page, context) => {
      renderedRequests.push({ params: context.request.params, url: context.request.url });
      return createReactServerEntry(
        createElement('html', null, createElement('body', null, page)),
        { headers: { 'x-react-page-renderer': 'application' } },
      );
    };

    @Inject(REACT_PAGE_RENDERER)
    @Router('/products')
    class ProductRouter {
      constructor(private readonly renderPage: ReactPageRenderer) {}

      @Path('/:id')
      show(_input: undefined, context: ReactRenderContext) {
        return this.renderPage(
          createElement('main', null, `Product ${context.request.params.id ?? 'missing'}`),
          context,
          { layouts: [] },
        );
      }
    }

    @Inject(REACT_PAGE_RENDERER)
    class PageRendererConsumer {
      constructor(readonly renderPage: ReactPageRenderer) {}
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [ProductRouter], renderPage: applicationRenderPage })],
      providers: [PageRendererConsumer],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/products/42'), response);
      const consumer = await app.get(PageRendererConsumer);

      expect(renderedRequests).toEqual([{ params: { id: '42' }, url: '/products/42' }]);
      expect(consumer.renderPage).toBe(applicationRenderPage);
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(response.headers['x-react-page-renderer']).toBe('application');
      expect(decodeBufferedBody(response)).toContain('Product 42');
    } finally {
      await app.close();
    }
  });

  it('leaves explicit ReactServerEntry handlers unchanged when renderPage is configured', async () => {
    let rendererCalls = 0;
    const applicationRenderPage: ReactPageRenderer = (page) => {
      rendererCalls += 1;
      return createReactServerEntry(page);
    };

    @Router('/explicit')
    class ExplicitEntryRouter {
      @Path('/')
      show() {
        return createReactServerEntry(createElement('main', null, 'Explicit entry'));
      }
    }

    @Module({
      imports: [ReactModule.forRoot({
        controllers: [ExplicitEntryRouter],
        renderPage: applicationRenderPage,
      })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/explicit'), response);

      expect(rendererCalls).toBe(0);
      expect(decodeBufferedBody(response)).toContain('Explicit entry');
    } finally {
      await app.close();
    }
  });

  it('passes resolved render policies and the active DI context to the application renderer', async () => {
    const ClassLayout: ReactPageLayout = ({ children }) => children;
    const MethodLayout: ReactPageLayout = ({ children }) => children;
    const MethodFallback: ReactSuspenseFallback = () => null;
    let handlerContainer: RequestScopeContainer | undefined;
    let rendererContainer: RequestScopeContainer | undefined;
    let renderedLayouts: readonly ReactPageLayout[] = [];
    let renderedFallback: ReactSuspenseFallback | undefined;
    const applicationRenderPage: ReactPageRenderer = (page, context, policies) => {
      rendererContainer = context.container;
      renderedLayouts = policies.layouts;
      renderedFallback = policies.suspenseFallback;
      return createReactServerEntry(createElement('html', null, createElement('body', null, page)));
    };

    // Given: class and method policies decorate one direct React page return.
    @PageLayout(ClassLayout)
    @Router('/policy-page')
    class PolicyRouter {
      @PageLayout(MethodLayout)
      @SuspenseFallback(MethodFallback)
      @Path('/')
      show(_input: undefined, context: ReactRenderContext) {
        handlerContainer = context.container;
        return createElement('main', null, 'Policy page');
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [PolicyRouter], renderPage: applicationRenderPage })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: the matched Path result reaches the application page renderer.
      const response = createResponse();
      await app.dispatch(createRequest('/policy-page'), response);

      // Then: policy order and request-scoped DI identity remain renderer-visible.
      expect(renderedLayouts).toEqual([ClassLayout, MethodLayout]);
      expect(renderedFallback).toBe(MethodFallback);
      expect(rendererContainer).toBe(handlerContainer);
      expect(decodeBufferedBody(response)).toContain('Policy page');
    } finally {
      await app.close();
    }
  });
});
