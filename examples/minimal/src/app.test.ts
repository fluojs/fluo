import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';
import { KonektiFactory } from '@fluojs/runtime';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';

import { AppModule } from './app';
import { HelloService } from './hello.service';
import { HelloController } from './hello.controller';

describe('HelloService', () => {
  it('returns a greeting message', () => {
    const service = new HelloService();
    expect(service.greet('Konekti')).toEqual({ message: 'Hello, Konekti!' });
  });
});

describe('HelloController', () => {
  it('delegates to HelloService', () => {
    const fakeService = { greet: () => ({ message: 'Hello, World!' }) };
    const controller = new HelloController(fakeService as HelloService);
    expect(controller.greet()).toEqual({ message: 'Hello, World!' });
  });
});

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

function createResponse(): FrameworkResponse & { body?: unknown } {
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
    statusCode: undefined,
    statusSet: false,
  };
}

describe('AppModule integration', () => {
  it('dispatches /health and /ready', async () => {
    const app = await KonektiFactory.create(AppModule, {});
    const healthRes = createResponse();
    const readyRes = createResponse();

    await app.dispatch(createRequest('/health'), healthRes);
    await app.dispatch(createRequest('/ready'), readyRes);

    expect(healthRes.body).toEqual({ status: 'ok' });
    expect(readyRes.body).toEqual({ status: 'ready' });

    await app.close();
  });

  it('dispatches /hello/', async () => {
    const app = await KonektiFactory.create(AppModule, {});
    const res = createResponse();

    await app.dispatch(createRequest('/hello/'), res);

    expect(res.body).toEqual({ message: 'Hello, World!' });

    await app.close();
  });
});

describe('AppModule e2e', () => {
  it('serves all routes through createTestApp', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.dispatch({ method: 'GET', path: '/health' })).resolves.toMatchObject({
      body: { status: 'ok' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/ready' })).resolves.toMatchObject({
      body: { status: 'ready' },
      status: 200,
    });
    await expect(app.dispatch({ method: 'GET', path: '/hello/' })).resolves.toMatchObject({
      body: { message: 'Hello, World!' },
      status: 200,
    });

    await app.close();
  });
});
