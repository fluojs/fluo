import { Module } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  Get,
  Produces,
} from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { bootstrapApplication } from './bootstrap.js';
import type {
  BootstrapApplicationOptions,
  CreateApplicationOptions,
} from './types.js';

type TestResponse = FrameworkResponse & { body?: unknown };

function createRequest(accept: string): FrameworkRequest {
  return {
    cookies: {},
    headers: { accept },
    method: 'GET',
    params: {},
    path: '/runtime-negotiation/report',
    query: {},
    raw: {},
    url: '/runtime-negotiation/report',
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

describe('runtime successful response content negotiation', () => {
  it('exposes and forwards bootstrap formatters through @Produces metadata', async () => {
    @Controller('/runtime-negotiation')
    class NegotiationController {
      @Produces('application/json', 'text/plain')
      @Get('/report')
      report() {
        return { total: 42 };
      }
    }

    @Module({ controllers: [NegotiationController] })
    class AppModule {}

    const contentNegotiation = {
      defaultMediaType: 'application/json',
      formatters: [
        {
          format(body: unknown) {
            return JSON.stringify(body);
          },
          mediaType: 'application/json',
        },
        {
          format(body: unknown) {
            return `total=${String((body as { total: number }).total)}`;
          },
          mediaType: 'text/plain',
        },
      ],
    };
    const createOptions: CreateApplicationOptions = { contentNegotiation };
    const options: BootstrapApplicationOptions = {
      ...createOptions,
      rootModule: AppModule,
    };
    const app = await bootstrapApplication(options);

    try {
      const response = createResponse();
      await app.dispatch(createRequest('text/plain'), response);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('text/plain');
      expect(response.headers.Vary).toBe('Accept');
      expect(response.body).toBe('total=42');
    } finally {
      await app.close();
    }
  });
});
