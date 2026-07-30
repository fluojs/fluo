import { Module } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import {
  createReactPageMetadataElements,
  PageMetadata,
  type ReactPageMetadataContext,
  resolveReactPageMetadata,
} from './page-metadata.js';
import type { ReactPageRenderer } from './page-renderer.js';
import type { ReactRenderContext } from './render.js';
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

describe('React page metadata renderer consumption', () => {
  it('resolves metadata only in the matched application renderer with response-free request scope', async () => {
    let handlerContainer: RequestScopeContainer | undefined;
    let metadataContainer: RequestScopeContainer | undefined;
    let metadataFactoryCalls = 0;
    let responseWasExposed = false;

    const productMetadata = (context: ReactPageMetadataContext) => {
      metadataFactoryCalls += 1;
      metadataContainer = context.container;
      responseWasExposed = Object.hasOwn(context, 'response');
      return {
        links: [{ href: `/products/${context.request.params.id}.css`, rel: 'stylesheet' }],
        meta: [{ content: context.request.path, name: 'description' }],
        title: `Product ${context.request.params.id}`,
      };
    };
    const renderPage: ReactPageRenderer = (page, context, policies) => {
      const metadata = resolveReactPageMetadata(policies, context);
      return createReactServerEntry(
        createElement(
          'html',
          null,
          createElement('head', null, ...createReactPageMetadataElements(metadata)),
          createElement('body', null, page),
        ),
      );
    };

    // Given: one matched Path declares request-aware page metadata.
    @Router('/products')
    class ProductRouter {
      @PageMetadata(productMetadata)
      @Path('/:id')
      show(_input: undefined, context: ReactRenderContext) {
        handlerContainer = context.container;
        return createElement('main', null, `Product ${context.request.params.id}`);
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [ProductRouter], renderPage })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: authoritative HTTP matching dispatches the page to the application renderer.
      const response = createResponse();
      await app.dispatch(createRequest('/products/42'), response);

      // Then: metadata uses the same request scope without exposing response mutation authority.
      expect(metadataFactoryCalls).toBe(1);
      expect(metadataContainer).toBe(handlerContainer);
      expect(responseWasExposed).toBe(false);
      const body = decodeBufferedBody(response);
      expect(body).toContain('<title>Product 42</title>');
      expect(body).toContain('<meta content="/products/42" name="description"/>');
      expect(body).toContain('<link href="/products/42.css" rel="stylesheet"/>');
    } finally {
      await app.close();
    }
  });
});
