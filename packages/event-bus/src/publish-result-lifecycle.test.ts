import { Inject } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { FluoFactory, type CompiledModule, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { EventBusLifecycleService, EventBusModule, OnEvent } from './index.js';

class LifecycleEvent {}

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('result-aware event lifecycle', () => {
  it('refuses publication after failed bootstrap while retaining the bootstrap rejection', async () => {
    // Given
    @Inject(Symbol('missing'))
    class BrokenHandler {
      @OnEvent(LifecycleEvent)
      handle() {}
    }
    const container = new Container();
    container.register(BrokenHandler);
    class AppModule {}
    const compiled = {
      accessibleTokens: new Set(), definition: { providers: [BrokenHandler] },
      exportedTokens: new Set(), importedExportedTokens: new Set(), providerTokens: new Set(), type: AppModule,
    } satisfies CompiledModule;
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    const bus = new EventBusLifecycleService(container, [compiled], logger, {});
    try {
      // When / Then
      await expect(bus.onApplicationBootstrap()).rejects.toThrow();
      expect(await bus.publishWithResult(new LifecycleEvent())).toEqual({ status: 'rejected', reason: 'failed' });
      expect(bus.createPlatformStatusSnapshot().details.lifecycleState).toBe('failed');
    } finally {
      await bus.onApplicationShutdown();
      await container.dispose();
    }
  });

  it('drains admitted background work even when shutdown starts before discovery continuation', async () => {
    // Given
    const started = createDeferred();
    const release = createDeferred();
    const events: string[] = [];
    class Handler {
      @OnEvent(LifecycleEvent)
      async handle() {
        started.resolve();
        await release.promise;
        events.push('handler:done');
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({
        transport: {
          async publish() {},
          async subscribe() {},
          async close() { events.push('transport:close'); },
        },
      })],
      providers: [Handler],
    });
    const app = await FluoFactory.create(AppModule);
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);

      // When
      const publication = bus.publishWithResult(new LifecycleEvent(), { waitForHandlers: false });
      const shutdown = bus.onApplicationShutdown();
      await started.promise;
      const receipt = await publication;

      // Then
      expect(events).toEqual([]);
      expect(await bus.publishWithResult(new LifecycleEvent())).toEqual({ status: 'rejected', reason: 'stopping' });
      release.resolve();
      if (receipt.status !== 'background') throw new Error('Expected completion receipt');
      expect(await receipt.completion).toMatchObject({
        status: 'settled', outcomes: [{ status: 'succeeded' }, { status: 'succeeded' }],
      });
      await shutdown;
      expect(events).toEqual(['handler:done', 'transport:close']);
    } finally {
      release.resolve();
      await app.close();
    }
  });

  it('observes background handler and synchronous transport failure without rejecting or skipping siblings', async () => {
    // Given
    const release = createDeferred();
    const started = createDeferred();
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    class Handler {
      @OnEvent(LifecycleEvent)
      async handle() {
        started.resolve();
        await release.promise;
        throw new Error('secret');
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({
        publish: { waitForHandlers: false },
        transport: {
          publish() { throw new Error('secret'); },
          async subscribe() {},
          async close() {},
        },
      })],
      providers: [Handler],
    });
    const app = await FluoFactory.create(AppModule, { logger });
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);

      // When
      const pending = bus.publishWithResult(new LifecycleEvent());
      await started.promise;
      const receipt = await pending;
      release.resolve();

      // Then
      if (receipt.status !== 'background') throw new Error('Expected completion receipt');
      expect(await receipt.completion).toMatchObject({
        status: 'settled',
        outcomes: [{ status: 'failed', reason: 'handler' }, { status: 'failed', reason: 'transport' }],
      });
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error.mock.calls.every((call) => call[1] === undefined)).toBe(true);
      expect(bus.createPlatformStatusSnapshot().details.transportPublishFailures).toBe(1);
    } finally {
      release.resolve();
      await app.close();
    }
  });
});
