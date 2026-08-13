import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { Saga } from './decorators.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsDispatchContext, CqrsEventBus, IEvent, ISaga } from './types.js';

function createDeferred<T = void>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<'blocked' | 'settled'> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const blocked = new Promise<'blocked'>((resolve) => {
    timeoutId = setTimeout(() => resolve('blocked'), timeoutMs);
  });

  try {
    return await Promise.race([promise.then(() => 'settled' as const), blocked]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

describe('CQRS saga provider-token FIFO contracts', () => {
  it('settles default delegated subscriber re-entry through the active saga token', async () => {
    // Given
    let activeHandles = 0;
    let maximumActiveHandles = 0;
    const handledSteps: string[] = [];
    const releaseBlockedSubscriber = createDeferred<void>();
    const subscriberStarted = createDeferred<void>();
    const subscriberPublishPromises: Promise<void>[] = [];

    class InitialEvent implements IEvent {}

    class NestedEvent implements IEvent {}

    class SubscriberEvent implements IEvent {}

    @Inject(EVENT_BUS)
    @Saga([InitialEvent, NestedEvent, SubscriberEvent])
    class ReentrantSaga implements ISaga<InitialEvent | NestedEvent | SubscriberEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(
        event: InitialEvent | NestedEvent | SubscriberEvent,
        context?: CqrsDispatchContext,
      ): Promise<void> {
        activeHandles += 1;
        maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
        handledSteps.push(`${event.constructor.name}:start`);

        try {
          if (event instanceof InitialEvent) {
            await this.eventBus.publish(new NestedEvent(), context);
          }
        } finally {
          handledSteps.push(`${event.constructor.name}:end`);
          activeHandles -= 1;
        }
      }
    }

    @Inject(EVENT_BUS)
    class NestedEventSubscriber {
      constructor(private readonly eventBus: CqrsEventBus) {}

      @OnEvent(NestedEvent)
      async publishBackIntoSagaToken(): Promise<void> {
        handledSteps.push('subscriber:start');
        const publishing = this.eventBus.publish(new SubscriberEvent());
        subscriberPublishPromises.push(publishing);
        subscriberStarted.resolve();
        await Promise.race([publishing, releaseBlockedSubscriber.promise]);
        handledSteps.push('subscriber:end');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ReentrantSaga, NestedEventSubscriber],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const publishing = eventBus.publish(new InitialEvent());
      await subscriberStarted.promise;
      const outcome = await settleWithin(publishing, 500);

      if (outcome === 'blocked') {
        releaseBlockedSubscriber.resolve();
      }

      await publishing;
      await Promise.all(subscriberPublishPromises);

      // Then
      expect(outcome).toBe('settled');
      expect(handledSteps).toEqual([
        'InitialEvent:start',
        'InitialEvent:end',
        'NestedEvent:start',
        'NestedEvent:end',
        'subscriber:start',
        'SubscriberEvent:start',
        'SubscriberEvent:end',
        'subscriber:end',
      ]);
      expect(maximumActiveHandles).toBe(1);
    } finally {
      releaseBlockedSubscriber.resolve();
      await app.close();
    }
  });

  it('runs external work enqueued before a nested continuation in provider-token FIFO order', async () => {
    // Given
    let activeHandles = 0;
    let maximumActiveHandles = 0;
    const handledSteps: string[] = [];
    const initialSagaStarted = createDeferred<void>();
    const releaseInitialSaga = createDeferred<void>();

    class InitialEvent implements IEvent {}

    class NestedEvent implements IEvent {}

    class ExternalEvent implements IEvent {}

    @Inject(EVENT_BUS)
    @Saga([InitialEvent, NestedEvent, ExternalEvent])
    class FifoSaga implements ISaga<InitialEvent | NestedEvent | ExternalEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(
        event: InitialEvent | NestedEvent | ExternalEvent,
        context?: CqrsDispatchContext,
      ): Promise<void> {
        activeHandles += 1;
        maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
        handledSteps.push(`${event.constructor.name}:start`);

        try {
          if (event instanceof InitialEvent) {
            initialSagaStarted.resolve();
            await releaseInitialSaga.promise;
            await this.eventBus.publish(new NestedEvent(), context);
          }
        } finally {
          handledSteps.push(`${event.constructor.name}:end`);
          activeHandles -= 1;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [FifoSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const sagaBus = await app.container.resolve(CqrsSagaLifecycleService);

    try {
      const publishingInitial = eventBus.publish(new InitialEvent());
      await initialSagaStarted.promise;

      // When
      const publishingExternal = eventBus.publish(new ExternalEvent());
      await vi.waitFor(() => {
        expect(sagaBus.getRuntimeSnapshot().inFlightSagaExecutions).toBe(2);
      });
      releaseInitialSaga.resolve();
      await Promise.all([publishingInitial, publishingExternal]);

      // Then
      expect(handledSteps).toEqual([
        'InitialEvent:start',
        'InitialEvent:end',
        'ExternalEvent:start',
        'ExternalEvent:end',
        'NestedEvent:start',
        'NestedEvent:end',
      ]);
      expect(maximumActiveHandles).toBe(1);
    } finally {
      releaseInitialSaga.resolve();
      await app.close();
    }
  });
});
