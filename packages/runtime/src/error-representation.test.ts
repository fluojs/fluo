import { Module } from '@fluojs/core';
import {
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpErrorRepresentationOptions,
} from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import { bootstrapApplication } from './bootstrap.js';
import type { BootstrapApplicationOptions } from './types.js';

type TestResponse = FrameworkResponse & { body?: unknown };
type BootstrapOptionsWithErrorRepresentation = BootstrapApplicationOptions & {
  readonly errorRepresentation: HttpErrorRepresentationOptions;
};

function createRequest(accept: string): FrameworkRequest {
  return {
    cookies: {},
    headers: { accept },
    method: 'GET',
    params: {},
    path: '/runtime-missing',
    query: {},
    raw: {},
    url: '/runtime-missing',
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

describe('runtime HTTP error representation registration', () => {
  it('forwards the application HTML provider into the dispatcher without bypassing JSON clients', async () => {
    @Module({})
    class AppModule {}

    const render = vi.fn(({ json }) => `<html><body>${json.error.code}</body></html>`);
    const options: BootstrapOptionsWithErrorRepresentation = {
      errorRepresentation: { html: { render } },
      rootModule: AppModule,
    };
    const app = await bootstrapApplication(options);

    try {
      const htmlResponse = createResponse();
      const jsonResponse = createResponse();

      await app.dispatch(createRequest('text/html'), htmlResponse);
      await app.dispatch(createRequest('application/json'), jsonResponse);

      expect(htmlResponse.statusCode).toBe(404);
      expect(htmlResponse.body).toBe('<html><body>NOT_FOUND</body></html>');
      expect(jsonResponse.statusCode).toBe(404);
      expect(jsonResponse.body).toMatchObject({ error: { code: 'NOT_FOUND', status: 404 } });
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
