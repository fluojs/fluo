import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type Dispatcher, type FrameworkRequest } from '@fluojs/http';
import {
  CloudflareWorkerHttpApplicationAdapter,
  CloudflareWorkerApplicationHost,
} from '@fluojs/platform-cloudflare-workers';
import {
  FluoFactory,
  defineModule,
  type ModuleType,
  type OnModuleInit,
} from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { RecordingExecutionContext, bounded } from '../support/child-runtime';

interface SlowGate {
  promise: Promise<void>;
}

/**
 * Local Web conformance composition for the Workers adapter. It runs the real
 * adapter (through the workspace source alias for its public package name)
 * inside the Node vitest runtime with real `Request` objects and a recording
 * `executionContext`. This is not a deployed-isolate guarantee: Worker
 * eviction, real WebSocketPair upgrades, and edge networking are owned by the
 * Workers runtime and are not exercised here.
 */
function createEdgeTestModule(generations: string[], gate: SlowGate): ModuleType {
  @Inject('GENERATIONS')
  class GenerationProbe implements OnModuleInit {
    constructor(private readonly seen: string[]) {}

    onModuleInit(): void {
      this.seen.push('boot');
    }
  }

  @Inject('SLOW_GATE')
  @Controller('/edge')
  class EdgeController {
    constructor(private readonly slowGate: SlowGate) {}

    @Get('/whoami')
    whoAmI(): { ok: boolean } {
      return { ok: true };
    }

    @Get('/slow')
    async slow(): Promise<string> {
      await this.slowGate.promise;
      return 'slow done';
    }
  }

  @Module({
    controllers: [EdgeController],
    providers: [GenerationProbe],
  })
  class EdgeTestModule {}

  return defineModule(EdgeTestModule, {
    controllers: [EdgeController],
    providers: [
      GenerationProbe,
      { provide: 'GENERATIONS', useValue: generations },
      { provide: 'SLOW_GATE', useValue: gate },
    ],
  });
}

describe('@fluojs/platform-cloudflare-workers composition', () => {
  it('routes a real factory application through adapter.fetch and registers its lifecycle with waitUntil', async () => {
    const adapter = CloudflareWorkerHttpApplicationAdapter.create();
    const app = await FluoFactory.create(createEdgeTestModule([], { promise: Promise.resolve() }), { adapter });
    const ctx = new RecordingExecutionContext();

    try {
      await app.listen();

      const response = await adapter.fetch(
        new Request('http://worker.test/edge/whoami'),
        { TOKEN: 'edge-secret' },
        ctx,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });

      // Every dispatch registers its completion with the Worker context; the
      // lifecycle must settle once the response is done.
      expect(ctx.tracked.length).toBe(1);
      await bounded(Promise.all(ctx.tracked), 'waitUntil lifecycle');
    } finally {
      await app.close();
    }
  });

  it('attaches Worker env and execution context to the framework request at the adapter dispatch boundary', async () => {
    // Adapter-boundary contract, exercised against the real adapter the same
    // way the owning package tests it: a minimal dispatcher receives the
    // framework request the adapter assembled. The shared dispatcher's request
    // reconstruction currently drops `cloudflare` before middleware and
    // handlers, so handler-level visibility is NOT asserted here; see the
    // fixture README (known discrepancies) and the owning package contract.
    const adapter = CloudflareWorkerHttpApplicationAdapter.create();
    const env = { TOKEN: 'edge-secret' };
    const ctx = new RecordingExecutionContext();
    let seenEnv: unknown;
    let seenContext: unknown;

    const dispatcher: Dispatcher = {
      async dispatch(request: FrameworkRequest, response) {
        const cloudflare = (request as FrameworkRequest & {
          cloudflare?: { env: unknown; executionContext: unknown };
        }).cloudflare;
        seenEnv = cloudflare?.env;
        seenContext = cloudflare?.executionContext;
        response.setStatus(200);
        await response.send({ ok: true });
      },
    };

    await adapter.listen(dispatcher);

    const response = await adapter.fetch(new Request('https://worker.test/edge/whoami'), env, ctx);

    expect(response.status).toBe(200);
    expect(seenEnv).toBe(env);
    expect(seenContext).toBe(ctx);

    await adapter.close();
  });

  it('gates new ingress behind 503 during close and rejects listen() while draining', async () => {
    let release!: () => void;
    const gate: SlowGate = { promise: new Promise<void>((resolve) => { release = resolve; }) };
    const adapter = CloudflareWorkerHttpApplicationAdapter.create();
    const app = await FluoFactory.create(createEdgeTestModule([], gate), { adapter });
    const dispatcher = app.dispatcher;

    try {
      await app.listen();

      // In-flight tracking happens synchronously on entry, so the close below
      // deterministically waits for this dispatch.
      const slowResponse = adapter.fetch(new Request('http://worker.test/edge/slow'), {}, new RecordingExecutionContext());
      const closing = adapter.close();

      const gated = await adapter.fetch(new Request('http://worker.test/edge/whoami'), {}, new RecordingExecutionContext());
      expect(gated.status).toBe(503);
      expect(await gated.json()).toMatchObject({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Server is shutting down.', status: 503 },
      });

      await expect(adapter.listen(dispatcher)).rejects.toThrow(
        'Cloudflare Workers adapter cannot listen while shutdown is still draining.',
      );

      release();

      const settled = await bounded(slowResponse, 'slow response');
      expect(settled.status).toBe(200);
      expect(await settled.text()).toBe('slow done');
      await bounded(closing, 'adapter close');

      // After a settled close, a direct adapter stays closed for new ingress.
      const afterClose = await adapter.fetch(new Request('http://worker.test/edge/whoami'), {}, new RecordingExecutionContext());
      expect(afterClose.status).toBe(503);
    } finally {
      release();
      await app.close();
    }
  });

  it('restarts the lazy host into a fresh generation that reruns bootstrap lifecycle hooks', async () => {
    const generations: string[] = [];
    const host = CloudflareWorkerApplicationHost.create(
      createEdgeTestModule(generations, { promise: Promise.resolve() }),
      { globalPrefix: 'api' },
    );

    try {
      const first = await bounded(
        host.fetch(new Request('http://worker.test/api/edge/whoami'), {}, new RecordingExecutionContext()),
        'first generation response',
      );
      expect(first.status).toBe(200);
      expect(generations).toEqual(['boot']);

      await host.close();

      const second = await bounded(
        host.fetch(new Request('http://worker.test/api/edge/whoami'), {}, new RecordingExecutionContext()),
        'second generation response',
      );
      expect(second.status).toBe(200);
      expect(generations).toEqual(['boot', 'boot']);
    } finally {
      await host.close();
    }
  });

  it('caches the env-derived configuration so the fromEnv factory runs once per host', async () => {
    let factoryCalls = 0;
    const host = CloudflareWorkerApplicationHost.create<{ token: string }>({
      fromEnv: (_env) => {
        factoryCalls += 1;
        return {
          rootModule: createEdgeTestModule([], { promise: Promise.resolve() }),
          options: {},
        };
      },
    });

    try {
      const first = await bounded(
        host.fetch(new Request('http://worker.test/edge/whoami'), { token: 'a' }, new RecordingExecutionContext()),
        'env-aware first response',
      );
      expect(first.status).toBe(200);
      expect(factoryCalls).toBe(1);

      await host.close();

      const second = await bounded(
        host.fetch(new Request('http://worker.test/edge/whoami'), { token: 'b' }, new RecordingExecutionContext()),
        'env-aware restarted response',
      );
      expect(second.status).toBe(200);
      expect(factoryCalls).toBe(1);
    } finally {
      await host.close();
    }
  });
});
