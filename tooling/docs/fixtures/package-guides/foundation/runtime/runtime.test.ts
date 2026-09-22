import { Module } from '@fluojs/core';
import { FluoFactory, HealthModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FirstService, LifecycleModule, lifecycleEvents } from './lifecycle.module';

/**
 * @fluojs/runtime guide evidence: context bootstrap with real lifecycle hook
 * ordering, health/readiness endpoint semantics, and terminal close.
 */

@Module({ imports: [LifecycleModule] })
class WorkerModule {}

describe('@fluojs/runtime guide examples', () => {
  beforeEach(() => {
    lifecycleEvents.length = 0;
  });

  it('runs startup and shutdown hooks in the documented order on a context', async () => {
    const context = await FluoFactory.createApplicationContext(WorkerModule);
    try {
      // Startup completed before createApplicationContext resolved.
      expect(lifecycleEvents).toEqual([
        'first:init',
        'second:init',
        'first:bootstrap',
        'second:bootstrap',
      ]);

      const first = await context.get(FirstService);
      expect(first).toBeInstanceOf(FirstService);
    } finally {
      await context.close();
    }

    expect(lifecycleEvents).toEqual([
      'first:init',
      'second:init',
      'first:bootstrap',
      'second:bootstrap',
      'second:destroy',
      'first:destroy',
      'second:shutdown',
      'first:shutdown',
    ]);
  });

  it('serves /health and /ready with readiness checks through the test app', async () => {
    const health = HealthModule.forRoot();
    health.addReadinessCheck((ctx) => {
      // Readiness checks receive the request context; keep this one
      // deterministic per request via a query flag.
      return ctx.request.query.fail !== '1';
    });

    @Module({ imports: [health] })
    class ReadyRootModule {}

    const app = await Test.createApp({ rootModule: ReadyRootModule });
    try {
      const healthResponse = await app.request('GET', '/health').send();
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toEqual({ status: 'ok' });

      const readyResponse = await app.request('GET', '/ready').send();
      expect(readyResponse.status).toBe(200);
      expect(readyResponse.body).toEqual({ status: 'ready' });

      const failingResponse = await app.request('GET', '/ready').query('fail', '1').send();
      expect(failingResponse.status).toBe(503);
      expect(failingResponse.body).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });

  it('rejects context.get after close begins', async () => {
    const context = await FluoFactory.createApplicationContext(WorkerModule);
    await context.close();

    await expect(context.get(FirstService)).rejects.toThrow();
  });
});
