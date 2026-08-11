import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { OnEvent } from './decorators.js';
import { EventBusModule } from './module.js';
import { EventBusLifecycleService } from './service.js';
import type { EventBusTransport } from './types.js';

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

class ShutdownRaceEvent {
  constructor(public readonly id: string) {}
}

describe('EventBusLifecycleService late shutdown work', () => {
  it('drains handler work registered after shutdown snapshots an active publish', async () => {
    // Given
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
      @OnEvent(ShutdownRaceEvent)
      async handle(_event: ShutdownRaceEvent) {
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

    try {
      const eventBus = await app.container.resolve(EventBusLifecycleService);

      // When
      const publishPromise = eventBus.publish(new ShutdownRaceEvent('late-handler'), { waitForHandlers: false });
      let shutdownCompleted = false;
      const shutdownPromise = eventBus.onApplicationShutdown().then(() => {
        shutdownCompleted = true;
      });
      await handlerStarted.promise;
      await publishPromise;
      await flushAsyncWork();

      // Then
      expect(shutdownCompleted).toBe(false);
      expect(transport.closeCalls).toBe(0);

      handlerGate.resolve();
      await shutdownPromise;
      expect(transport.closeCalls).toBe(1);
    } finally {
      handlerGate.resolve();
      await app.close();
    }
  });

  it('drains transport work registered after shutdown snapshots an active publish', async () => {
    // Given
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

    try {
      const eventBus = await app.container.resolve(EventBusLifecycleService);
      vi.useFakeTimers();

      // When
      const publishPromise = eventBus.publish(new ShutdownRaceEvent('late-transport'), { waitForHandlers: false });
      let shutdownCompleted = false;
      const shutdownPromise = eventBus.onApplicationShutdown().then(() => {
        shutdownCompleted = true;
      });
      await publishStarted.promise;
      await publishPromise;
      await vi.advanceTimersByTimeAsync(0);

      // Then
      expect(shutdownCompleted).toBe(false);
      expect(transport.closeCalls).toBe(0);

      publishGate.resolve();
      await shutdownPromise;
      expect(transport.closeCalls).toBe(1);
    } finally {
      publishGate.resolve();
      await app.close();
      vi.useRealTimers();
    }
  });
});
