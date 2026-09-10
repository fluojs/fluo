import { randomUUID } from 'node:crypto';

import { Module } from '@fluojs/core';
import { All, Controller, type RequestContext } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { createNextAppRouterHandler } from './app-router.js';
import { defineNextApplication, NextHttpApplicationAdapter } from './index.js';

@Controller('/api')
class MethodsController {
  @All('/methods')
  method(_input: undefined, context: RequestContext) {
    context.response.setHeader('x-original-method', context.request.method);
    return { method: context.request.method };
  }
}

@Module({ controllers: [MethodsController] })
class AppModule {}

describe('App Router callback facade', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const)(
    'dispatches Next %s exports with the original Web request',
    async (method) => {
      // Given the lazy facade and an ordinary, application-owned adapter.
      const adapter = NextHttpApplicationAdapter.create({ headRouting: 'explicit-or-get' });
      const app = await FluoFactory.create(AppModule, { adapter });
      let loads = 0;
      const handlers = createNextAppRouterHandler(async () => {
        loads += 1;
        await app.listen();
        return adapter;
      });
      try {
        expect(loads).toBe(0);
        // When Next invokes its named method export.
        const response = await handlers[method](new Request('https://next.test/api/methods', { method }));
        // Then routing observes the original method, including bodyless HEAD.
        expect(response.status).toBe(200);
        expect(response.headers.get('x-original-method')).toBe(method);
        if (method === 'HEAD') expect(response.body).toBeNull();
        else await expect(response.json()).resolves.toEqual({ method });
        expect(loads).toBe(1);
      } finally {
        await app.close();
      }
    },
  );

  it('keeps independent closure caches unless loaders opt into one application key', async () => {
    // Given one loader used by separate facade definitions.
    const adapter = NextHttpApplicationAdapter.create();
    let loads = 0;
    const load = async () => { loads += 1; return adapter; };
    const left = createNextAppRouterHandler(load);
    const right = createNextAppRouterHandler(load);
    const get = defineNextApplication({ key: randomUUID(), load });
    const sharedLeft = createNextAppRouterHandler(get);
    const sharedRight = createNextAppRouterHandler(get);
    try {
      // When each closure receives overlapping requests.
      await Promise.all([left, left, right, sharedLeft, sharedRight].map((handler) =>
        handler.GET(new Request('https://next.test/api/methods'))));
      // Then two ordinary closures load twice, while the keyed pair loads once.
      expect(loads).toBe(3);
    } finally {
      await adapter.close();
    }
  });

  it.each(['synchronous', 'asynchronous'])('retains %s loader failure per closure', async (mode) => {
    // Given a loader whose first bootstrap fails.
    const failure = new Error('bootstrap failed');
    let loads = 0;
    const handlers = createNextAppRouterHandler(() => {
      loads += 1;
      if (mode === 'synchronous') throw failure;
      return Promise.reject(failure);
    });
    // When multiple method callbacks request the same facade.
    const outcomes = await Promise.allSettled([
      handlers.GET(new Request('https://next.test/')),
      handlers.POST(new Request('https://next.test/', { method: 'POST' })),
    ]);
    // Then neither callback retries or replaces the cached error.
    expect(outcomes).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(loads).toBe(1);
  });
});
