import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { EventBusLifecycleService, EventBusModule, OnEvent } from './index.js';

class BoundedEvent {}

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function createBoundedBus() {
  const handlerStarted = createDeferred();
  const transportStarted = createDeferred();
  const handlerGate = createDeferred();
  const transportGate = createDeferred();
  const events: string[] = [];
  const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
  class Handler {
    @OnEvent(BoundedEvent)
    async handle() {
      handlerStarted.resolve();
      await handlerGate.promise;
      events.push('handler:done');
    }
  }
  class AppModule {}
  defineModule(AppModule, {
    imports: [EventBusModule.forRoot({
      shutdown: { drainTimeoutMs: 50 },
      transport: {
        async publish() {
          transportStarted.resolve();
          await transportGate.promise;
          events.push('transport:done');
        },
        async subscribe() {},
        async close() { events.push('transport:close'); },
      },
    })],
    providers: [Handler],
  });
  const app = await FluoFactory.create(AppModule, { logger });
  const bus = await app.container.resolve(EventBusLifecycleService);
  return {
    app, bus, events, logger,
    started: Promise.all([handlerStarted.promise, transportStarted.promise]),
    release() { handlerGate.resolve(); transportGate.resolve(); },
  };
}

describe('result-aware publication bounds', () => {
  it('releases timeout resources when a transport aborts synchronously during dispatch', async () => {
    // Given
    const controller = new AbortController();
    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({
        transport: {
          async publish() { controller.abort(); },
          async subscribe() {},
          async close() {},
        },
      })],
    });
    const app = await FluoFactory.create(AppModule);
    vi.useFakeTimers();
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);

      // When
      const result = await bus.publishWithResult(new BoundedEvent(), { signal: controller.signal, timeoutMs: 100 });

      // Then
      expect(result).toMatchObject({
        status: 'settled', outcomes: [{ status: 'cancelled', started: true }],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it.each(['timeout', 'cancel'] as const)('observes %s without terminating either recipient or losing drain tracking', async (bound) => {
    // Given
    const fixture = await createBoundedBus();
    const controller = new AbortController();
    vi.useFakeTimers();
    try {
      // When
      const pending = fixture.bus.publishWithResult(new BoundedEvent(), {
        signal: controller.signal, timeoutMs: 12,
      });
      await fixture.started;
      if (bound === 'timeout') {
        await vi.advanceTimersByTimeAsync(12);
      } else {
        controller.abort('secret-abort-reason');
      }
      const result = await pending;

      // Then
      expect(result).toMatchObject({
        status: 'settled',
        outcomes: [
          bound === 'timeout' ? { status: 'timed-out', timeoutMs: 12 } : { status: 'cancelled', started: true },
          bound === 'timeout' ? { status: 'timed-out', timeoutMs: 12 } : { status: 'cancelled', started: true },
        ],
      });
      expect(fixture.events).toEqual([]);
      expect(fixture.bus.createPlatformStatusSnapshot().details.transportPublishFailures).toBe(1);
      expect(fixture.logger.warn).toHaveBeenCalledTimes(2);
      const closing = fixture.bus.onApplicationShutdown();
      expect(await fixture.bus.publishWithResult(new BoundedEvent())).toEqual({ status: 'rejected', reason: 'stopping' });
      expect(fixture.events).toEqual([]);
      fixture.release();
      await closing;
      expect(fixture.events.at(-1)).toBe('transport:close');
      expect(fixture.events.slice(0, 2).sort()).toEqual(['handler:done', 'transport:done']);
      expect(JSON.stringify(result)).not.toContain('secret-abort-reason');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      fixture.release();
      await fixture.app.close();
      vi.useRealTimers();
    }
  });

  it.each([true, false])('skips every recipient for an already-aborted signal with waitForHandlers=%s', async (waitForHandlers) => {
    // Given
    const fixture = await createBoundedBus();
    const controller = new AbortController();
    controller.abort();
    try {
      // When
      const receipt = await fixture.bus.publishWithResult(new BoundedEvent(), { signal: controller.signal, waitForHandlers });
      const result = receipt.status === 'background' ? await receipt.completion : receipt;

      // Then
      expect(result).toMatchObject({
        status: 'settled',
        outcomes: [{ status: 'cancelled', started: false }, { status: 'cancelled', started: false }],
      });
      expect(fixture.events).toEqual([]);
      expect(fixture.bus.createPlatformStatusSnapshot().details.transportPublishFailures).toBe(0);
      expect(fixture.logger.warn).toHaveBeenCalledTimes(2);
    } finally {
      fixture.release();
      await fixture.app.close();
    }
  });

  it('keeps a background receipt pending beyond timeout, cancellation, and bounded shutdown', async () => {
    // Given
    const fixture = await createBoundedBus();
    const controller = new AbortController();
    vi.useFakeTimers();
    try {
      // When
      const pending = fixture.bus.publishWithResult(new BoundedEvent(), {
        waitForHandlers: false, signal: controller.signal, timeoutMs: 1,
      });
      await fixture.started;
      const receipt = await pending;
      expect(receipt.status).toBe('background');
      if (receipt.status !== 'background') throw new Error('Expected completion receipt');
      let completed = false;
      const completion = receipt.completion.then((result) => { completed = true; return result; });
      controller.abort();
      const closing = fixture.bus.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(50);
      await closing;

      // Then
      expect(completed).toBe(false);
      expect(fixture.events).toEqual(['transport:close']);
      expect(fixture.bus.createPlatformStatusSnapshot().details.shutdownDrainTimeouts).toBe(1);
      expect(fixture.bus.createPlatformStatusSnapshot().details.transportPublishFailures).toBe(0);
      expect(await fixture.bus.publishWithResult(new BoundedEvent())).toEqual({ status: 'rejected', reason: 'stopped' });
      fixture.release();
      expect(await completion).toMatchObject({
        status: 'settled', outcomes: [{ status: 'succeeded' }, { status: 'succeeded' }],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      fixture.release();
      await fixture.app.close();
      vi.useRealTimers();
    }
  });
});
