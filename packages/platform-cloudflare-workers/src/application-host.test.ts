import { Controller, Get } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CloudflareWorkerApplicationHost,
  type CloudflareWorkerExecutionContext,
  CloudflareWorkerHttpApplicationAdapter,
} from './adapter.js';

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

describe('CloudflareWorkerApplicationHost', () => {
  it('keeps a module with a fromEnv static member on the fixed-module path', async () => {
    class AppModule {
      static fromEnv() {
        throw new Error('A module static member is not host configuration.');
      }
    }
    defineModule(AppModule, {});
    const host = CloudflareWorkerApplicationHost.create(AppModule);
    try {
      await expect(host.ready()).resolves.toHaveProperty('adapter');
    } finally {
      await host.close();
    }
  });

  it('creates no-socket Worker generations through the canonical static factories', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const host = CloudflareWorkerApplicationHost.create(AppModule, {
      cors: false,
    });

    try {
      const generation = await host.ready();
      const response = await host.fetch(
        new Request('https://worker.test/health'),
        {},
        createExecutionContext(),
      );

      expect(generation.adapter).toBeInstanceOf(CloudflareWorkerHttpApplicationAdapter);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await host.close();
    }
  });

  it('requires an environment for env-configured host readiness', () => {
    type WorkerEnv = {
      readonly prefix: string;
    };

    class AppModule {}
    defineModule(AppModule, {});

    const host = CloudflareWorkerApplicationHost.create<WorkerEnv>({
      fromEnv: (env) => ({
        options: {
          globalPrefix: env.prefix,
        },
        rootModule: AppModule,
      }),
    });

    expectTypeOf(host.ready).parameter(0).toEqualTypeOf<WorkerEnv>();
  });
});
