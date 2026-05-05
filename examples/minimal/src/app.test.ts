import { describe, expect, it } from 'vitest';

import { createTestApp } from '@fluojs/testing';

import { AppModule } from './app';
import { HelloService } from './hello.service';
import { HelloController } from './hello.controller';

describe('HelloService', () => {
  it('returns a greeting message', () => {
    const service = new HelloService();
    expect(service.greet('fluo')).toEqual({ message: 'Hello, fluo!' });
  });
});

describe('HelloController', () => {
  it('delegates to HelloService', () => {
    const fakeService = { greet: () => ({ message: 'Hello, World!' }) };
    const controller = new HelloController(fakeService as HelloService);
    expect(controller.greet()).toEqual({ message: 'Hello, World!' });
  });
});

describe('AppModule e2e', () => {
  it('serves all routes through createTestApp request helpers', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    await expect(app.request('GET', '/health').send()).resolves.toMatchObject({
      body: { status: 'ok' },
      status: 200,
    });
    await expect(app.request('GET', '/ready').send()).resolves.toMatchObject({
      body: { status: 'ready' },
      status: 200,
    });
    await expect(app.request('GET', '/hello/').send()).resolves.toMatchObject({
      body: { message: 'Hello, World!' },
      status: 200,
    });

    await app.close();
  });
});
