import { Module } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  NotFoundException,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { PageMetadata } from './page-metadata.js';
import type { ReactPageRenderer } from './page-renderer.js';
import { createReactServerEntry } from './server-entry.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type OwnershipFixture = {
  readonly app: Awaited<ReturnType<typeof bootstrapApplication>>;
  readonly metadataCalls: () => number;
  readonly rendererCalls: () => number;
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
    },
  };
}

async function createOwnershipFixture(): Promise<OwnershipFixture> {
  let metadataCalls = 0;
  let rendererCalls = 0;
  const metadata = () => {
    metadataCalls += 1;
    return { title: 'Owned metadata' };
  };
  const renderPage: ReactPageRenderer = (page) => {
    rendererCalls += 1;
    return createReactServerEntry(page);
  };

  @Router('/owned')
  class OwnedRouter {
    @PageMetadata(metadata)
    @Path('/explicit')
    explicit() {
      return createReactServerEntry(createElement('main', null, 'Explicit entry'));
    }

    @PageMetadata(metadata)
    @Path('/missing')
    missing(): never {
      throw new NotFoundException('Owned page resource not found.');
    }
  }

  @Controller('/api')
  class ApiController {
    @Get('/element')
    element() {
      return createElement('main', null, 'Ordinary HTTP element');
    }
  }

  @Module({
    controllers: [ApiController],
    imports: [ReactModule.forRoot({ controllers: [OwnedRouter], renderPage })],
  })
  class AppModule {}

  return {
    app: await bootstrapApplication({ rootModule: AppModule }),
    metadataCalls: () => metadataCalls,
    rendererCalls: () => rendererCalls,
  };
}

describe('React page metadata HTTP ownership', () => {
  it('leaves unmatched requests on the HTTP-owned not-found path', async () => {
    const fixture = await createOwnershipFixture();

    try {
      // Given: metadata exists only on registered React page handlers.
      const response = createResponse();

      // When: HTTP matching cannot find a handler.
      await fixture.app.dispatch(createRequest('/unmatched'), response);

      // Then: HTTP emits its canonical 404 without invoking React metadata or rendering.
      expect(response.statusCode).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
      expect(fixture.metadataCalls()).toBe(0);
      expect(fixture.rendererCalls()).toBe(0);
    } finally {
      await fixture.app.close();
    }
  });

  it('leaves handler-thrown NotFoundException on the HTTP error path', async () => {
    const fixture = await createOwnershipFixture();

    try {
      // Given: a matched metadata-decorated page handler owns a missing resource check.
      const response = createResponse();

      // When: the handler throws the HTTP-owned not-found outcome.
      await fixture.app.dispatch(createRequest('/owned/missing'), response);

      // Then: no React presentation policy consumes or rewrites the HTTP error.
      expect(response.statusCode).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
      expect(fixture.metadataCalls()).toBe(0);
      expect(fixture.rendererCalls()).toBe(0);
    } finally {
      await fixture.app.close();
    }
  });

  it('leaves explicit ReactServerEntry results outside metadata renderer consumption', async () => {
    const fixture = await createOwnershipFixture();

    try {
      // Given: a metadata-decorated Path returns an explicit server entry.
      const response = createResponse();

      // When: HTTP dispatch finalizes that entry.
      await fixture.app.dispatch(createRequest('/owned/explicit'), response);

      // Then: the explicit entry bypasses both the application renderer and metadata factories.
      expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(fixture.metadataCalls()).toBe(0);
      expect(fixture.rendererCalls()).toBe(0);
    } finally {
      await fixture.app.close();
    }
  });

  it('leaves React elements from ordinary HTTP controllers on the non-React value path', async () => {
    const fixture = await createOwnershipFixture();

    try {
      // Given: an ordinary HTTP controller returns a value React recognizes as an element.
      const response = createResponse();

      // When: HTTP dispatch writes the ordinary controller result.
      await fixture.app.dispatch(createRequest('/api/element'), response);

      // Then: React page metadata and the application renderer do not claim the result.
      expect(response.body).toMatchObject({ type: 'main' });
      expect(fixture.metadataCalls()).toBe(0);
      expect(fixture.rendererCalls()).toBe(0);
    } finally {
      await fixture.app.close();
    }
  });
});
