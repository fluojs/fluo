import { Module } from '@fluojs/core';
import {
  type FrameworkRequest,
  type FrameworkResponse,
  type HtmlErrorRepresentationProvider,
  type HttpErrorRepresentationContext,
  NotFoundException,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as reactApi from './index.js';
import { ReactModule } from './module.js';
import { PageMetadata } from './page-metadata.js';
import type { ReactPageRenderer } from './page-renderer.js';
import { PageLayout, SuspenseFallback } from './render-policy.js';
import {
  type ReactReadableStreamRenderer,
  type ReactRenderContext,
  renderReactResponse,
} from './render.js';
import { createReactServerEntry, type ReactServerEntry } from './server-entry.js';
import { Path, Router } from './decorators.js';

type ErrorDocumentRenderer = (
  context: HttpErrorRepresentationContext,
) => ReactServerEntry | Promise<ReactServerEntry>;

type ErrorProviderFactory = (options: {
  readonly canRender?: HtmlErrorRepresentationProvider['canRender'];
  readonly renderDocument: ErrorDocumentRenderer;
  readonly renderToReadableStream?: ReactReadableStreamRenderer;
}) => HtmlErrorRepresentationProvider;

type TestResponse = FrameworkResponse & { body?: unknown };
type ReactResponseWriterContext = {
  readonly applySuccessResponseMetadata: () => void;
  readonly requestContext: ReactRenderContext;
};

function isErrorProviderFactory(value: unknown): value is ErrorProviderFactory {
  return typeof value === 'function';
}

function resolveErrorProviderFactory(): ErrorProviderFactory {
  const candidate: unknown = Reflect.get(reactApi, 'createReactErrorRepresentationProvider');
  if (!isErrorProviderFactory(candidate)) {
    throw new Error('Expected createReactErrorRepresentationProvider to be exported.');
  }
  return candidate;
}

function createRequest(path: string): FrameworkRequest {
  return {
    cookies: {},
    headers: { accept: 'text/html' },
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    requestId: 'react-error-2889',
    url: path,
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

function decodeBody(body: unknown): string {
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  return typeof body === 'string' ? body : '';
}

describe('React HTTP error representation integration', () => {
  it('renders an application document after HTTP classifies an unmatched route without consulting page policies', async () => {
    const layout = vi.fn(({ children }: { readonly children: ReactNode }) => children);
    const fallback = vi.fn(() => createElement('p', null, 'Loading'));
    const metadata = vi.fn(() => ({ title: 'Matched page' }));
    const renderPage = vi.fn<ReactPageRenderer>((page) => createReactServerEntry(page));

    @PageLayout(layout)
    @Router('/owned')
    class OwnedRouter {
      @PageMetadata(metadata)
      @SuspenseFallback(fallback)
      @Path('/missing')
      missing(): never {
        throw new NotFoundException('Owned resource missing.');
      }
    }

    const renderDocument = vi.fn((context: HttpErrorRepresentationContext) => createReactServerEntry(
      createElement('html', { lang: 'en' },
        createElement('body', null, `${context.json.error.status}:${context.json.error.code}`)),
      { headers: { 'x-react-entry': 'ignored' }, status: 299 },
    ));
    const provider = resolveErrorProviderFactory()({ renderDocument });

    @Module({
      imports: [ReactModule.forRoot({ controllers: [OwnedRouter], renderPage })],
    })
    class AppModule {}

    const app = await bootstrapApplication({
      errorRepresentation: { html: provider },
      logger: { debug() {}, error() {}, log() {}, warn() {} },
      rootModule: AppModule,
    });

    try {
      const unmatchedResponse = createResponse();
      const handlerResponse = createResponse();

      await app.dispatch(createRequest('/not-registered'), unmatchedResponse);
      await app.dispatch(createRequest('/owned/missing'), handlerResponse);

      expect(unmatchedResponse.statusCode).toBe(404);
      expect(unmatchedResponse.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(unmatchedResponse.headers['x-react-entry']).toBeUndefined();
      expect(decodeBody(unmatchedResponse.body)).toContain('404:NOT_FOUND');
      expect(handlerResponse.statusCode).toBe(404);
      expect(decodeBody(handlerResponse.body)).toContain('404:NOT_FOUND');
      expect(renderDocument.mock.calls[0]?.[0]).not.toHaveProperty('handler');
      expect(renderDocument).toHaveBeenNthCalledWith(2, expect.objectContaining({
        handler: expect.objectContaining({ methodName: 'missing' }),
      }));
      expect(layout).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      expect(metadata).not.toHaveBeenCalled();
      expect(renderPage).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('propagates React representation rendering failures to the HTTP non-recursive JSON fallback', async () => {
    const representationError = new Error('React error document failed.');
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => {
      throw representationError;
    });
    const provider = resolveErrorProviderFactory()({
      renderDocument: () => createReactServerEntry(createElement('html')),
      renderToReadableStream,
    });

    @Module({})
    class AppModule {}

    const app = await bootstrapApplication({
      errorRepresentation: { html: provider },
      logger: { debug() {}, error() {}, log() {}, warn() {} },
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/broken-document'), response);

      expect(response.statusCode).toBe(404);
      expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
      expect(renderToReadableStream).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('keeps matched React pre-commit shell failures outside the HttpException representation phase', async () => {
    const shellError = new Error('Matched page shell failed.');
    const entry: ReactServerEntry = {
      assetMap: {},
      bootstrapModules: [],
      bootstrapScripts: [],
      headers: {},
      node: createElement('html'),
    };
    Object.defineProperty(entry, Symbol.for('fluo.http.responseWriter'), {
      value: async (context: ReactResponseWriterContext) => {
        await renderReactResponse(entry, context.requestContext, {
          applySuccessResponseMetadata: context.applySuccessResponseMetadata,
          renderToReadableStream: async () => {
            throw shellError;
          },
        });
      },
    });

    @Router('/shell-failure')
    class ShellFailureRouter {
      @Path('/')
      show() {
        return entry;
      }
    }

    const renderDocument = vi.fn(() => createReactServerEntry(createElement('html')));
    const provider = resolveErrorProviderFactory()({ renderDocument });

    @Module({ imports: [ReactModule.forRoot({ controllers: [ShellFailureRouter] })] })
    class AppModule {}

    const app = await bootstrapApplication({
      errorRepresentation: { html: provider },
      logger: { debug() {}, error() {}, log() {}, warn() {} },
      rootModule: AppModule,
    });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/shell-failure'), response);

      expect(response.statusCode).toBe(500);
      expect(response.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR', status: 500 } });
      expect(renderDocument).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
