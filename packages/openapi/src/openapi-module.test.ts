import { describe, expect, it } from 'vitest';

import { Controller, Get, Post, createHandlerMapping, type FrameworkRequest, type FrameworkResponse } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { OpenApiModule } from './openapi-module.js';

type TestFrameworkResponse = FrameworkResponse & { body?: unknown };

function createRequest(method: string, path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestFrameworkResponse {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('location', location);
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
    },
    statusCode: 200,
  };
}

describe('OpenApiModule', () => {
  it('serves a valid OpenAPI 3.1 document at /openapi.json', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      listUsers() {
        return [{ id: '1' }];
      }

      @Post('/')
      createUser() {
        return { id: '2' };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: UsersController }]).descriptors;
    const openApiModule = OpenApiModule.forRoot({
      descriptors,
      title: 'Test API',
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/openapi.json'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        openapi: '3.1.0',
        paths: {
          '/users': {
            get: expect.objectContaining({
              tags: ['UsersController'],
            }),
            post: expect.objectContaining({
              tags: ['UsersController'],
            }),
          },
        },
      }),
    );
  });

  it('serves Swagger UI at /docs when ui is enabled', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const descriptors = createHandlerMapping([{ controllerToken: HealthController }]).descriptors;
    const openApiModule = OpenApiModule.forRoot({
      descriptors,
      title: 'Docs API',
      ui: true,
      version: '1.0.0',
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [HealthController],
      imports: [openApiModule],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });
    const response = createResponse();

    await app.dispatch(createRequest('GET', '/docs'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body).toEqual(expect.stringContaining("url: '/openapi.json'"));
    expect(response.body).toEqual(expect.stringContaining('SwaggerUIBundle'));
  });
});
