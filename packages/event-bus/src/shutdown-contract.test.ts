import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnEvent } from './decorators.js';
import { EventBusModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { EventBus, EventBusTransport } from './types.js';

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class ShutdownEvent {
  constructor(public readonly id: string) {}
}

describe('EventBusLifecycleService shutdown contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains non-blocking local handler work before closing the transport', async () => {
    const handlerGate = createDeferred();
    const handlerStarted = createDeferred();
    const transport = {
      closeCalls: 0,
      async publish(_channel: string, _payload: unknown) {},
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
      async close() {
        this.closeCalls += 1;
      },
    } satisfies EventBusTransport & { closeCalls: number };

    class SlowHandler {
      @OnEvent(ShutdownEvent)
      async handle(_event: ShutdownEvent) {
        handlerStarted.resolve();
        await handlerGate.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ transport })],
      providers: [SlowHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

    await eventBus.publish(new ShutdownEvent('background-handler'), { waitForHandlers: false });
    await handlerStarted.promise;

    let closeResolved = false;
    const closePromise = app.close().then(() => {
      closeResolved = true;
    });
    await flushAsyncWork();

    expect(closeResolved).toBe(false);
    expect(transport.closeCalls).toBe(0);

    handlerGate.resolve();
    await closePromise;

    expect(transport.closeCalls).toBe(1);
  });

  it('drains non-blocking transport publish work before closing the transport', async () => {
    const publishGate = createDeferred();
    const publishStarted = createDeferred();
    const transport = {
      closeCalls: 0,
      async publish(_channel: string, _payload: unknown) {
        publishStarted.resolve();
        await publishGate.promise;
      },
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
      async close() {
        this.closeCalls += 1;
      },
    } satisfies EventBusTransport & { closeCalls: number };

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ transport })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

    await eventBus.publish(new ShutdownEvent('background-transport'), { waitForHandlers: false });
    await publishStarted.promise;

    let closeResolved = false;
    const closePromise = app.close().then(() => {
      closeResolved = true;
    });
    await flushAsyncWork();

    expect(closeResolved).toBe(false);
    expect(transport.closeCalls).toBe(0);

    publishGate.resolve();
    await closePromise;

    expect(transport.closeCalls).toBe(1);
  });

  it('drains non-blocking transport publish work after an in-flight abort', async () => {
    const publishGate = createDeferred();
    const publishStarted = createDeferred();
    const transport = {
      closeCalls: 0,
      async publish(_channel: string, _payload: unknown) {
        publishStarted.resolve();
        await publishGate.promise;
      },
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
      async close() {
        this.closeCalls += 1;
      },
    } satisfies EventBusTransport & { closeCalls: number };

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ transport })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const controller = new AbortController();
    const publishPromise = eventBus.publish(new ShutdownEvent('aborted-transport'), {
      signal: controller.signal,
      waitForHandlers: false,
    });

    await publishStarted.promise;
    controller.abort();
    await expect(publishPromise).resolves.toBeUndefined();
    await flushAsyncWork();

    let closeResolved = false;
    const closePromise = app.close().then(() => {
      closeResolved = true;
    });
    await flushAsyncWork();

    expect(closeResolved).toBe(false);
    expect(transport.closeCalls).toBe(0);

    publishGate.resolve();
    await closePromise;

    expect(transport.closeCalls).toBe(1);
  });

  it('bounds a permanently pending inbound handler before closing the transport', async () => {
    vi.useFakeTimers();
    const handlerStarted = createDeferred();
    let subscription: ((payload: unknown) => Promise<void>) | undefined;
    const transport = {
      closeCalls: 0,
      async publish(_channel: string, _payload: unknown) {},
      async subscribe(_channel: string, handler: (payload: unknown) => Promise<void>) {
        subscription = handler;
      },
      async close() {
        this.closeCalls += 1;
      },
    } satisfies EventBusTransport & { closeCalls: number };

    class PendingHandler {
      @OnEvent(ShutdownEvent)
      async handle(_event: ShutdownEvent) {
        handlerStarted.resolve();
        await new Promise<void>(() => undefined);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ shutdown: { drainTimeoutMs: 20 }, transport })],
      providers: [PendingHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    if (!subscription) {
      throw new TypeError('Expected EventBus transport subscription to be registered during bootstrap.');
    }

    void subscription({ id: 'pending-inbound' });
    await handlerStarted.promise;

    let closeResolved = false;
    const closePromise = app.close().then(() => {
      closeResolved = true;
    });
    await flushAsyncWork();

    expect(closeResolved).toBe(false);
    expect(transport.closeCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(20);
    await closePromise;

    expect(closeResolved).toBe(true);
    expect(transport.closeCalls).toBe(1);
  });
});
