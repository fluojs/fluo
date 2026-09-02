import { OnEvent } from '@fluojs/event-bus';
import { type ApplicationLogger, bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CqrsEventBusService } from './buses/event-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { EventHandler, Saga } from './decorators.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsEventBus, IEvent, IEventHandler, ISaga } from './types.js';

const DRAIN_TIMEOUT_MS = 20;

function createDeferred<T = void>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function createLogger(events: string[]): ApplicationLogger {
  return {
    debug: () => undefined,
    error: () => undefined,
    log: () => undefined,
    warn(message: string, context?: string) {
      events.push(`warn:${context ?? 'none'}:${message}`);
    },
  };
}

describe('CQRS single shutdown deadline contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps an explicit delegated event-bus timeout at one CQRS drain window', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const releaseSubscriber = createDeferred<void>();
    const subscriberStarted = createDeferred<void>();

    class DelegatedEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class StuckSubscriber {
      @OnEvent(DelegatedEvent)
      async onDelegatedEvent(): Promise<void> {
        subscriberStarted.resolve();
        await releaseSubscriber.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CqrsModule.forRoot({
          eventBus: { shutdown: { drainTimeoutMs: 5000 } },
          shutdown: { drainTimeoutMs: DRAIN_TIMEOUT_MS },
        }),
      ],
      providers: [StuckSubscriber],
    });

    const app = await bootstrapApplication({ logger: createLogger(loggerEvents), rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const publishPromise = eventBus.publish(new DelegatedEvent('delegated-stuck'));

    await subscriberStarted.promise;

    let closeSettled = false;
    const closePromise = app.close().then(() => {
      closeSettled = true;
    });

    try {
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);

      expect(closeSettled).toBe(true);
      expect(loggerEvents).toEqual([
        'warn:CqrsEventBusService:CQRS event shutdown drain exceeded 20ms with 1 active publish pipeline(s); continuing shutdown.',
        'warn:CqrsSagaLifecycleService:CQRS saga shutdown drain exceeded 0ms with 1 active saga task(s); continuing shutdown.',
        'warn:EventBusLifecycleService:Event bus shutdown drain exceeded 0ms with 2 active dispatch workflow(s); continuing shutdown.',
      ]);
    } finally {
      releaseSubscriber.resolve();
      await vi.runAllTimersAsync();
      await Promise.allSettled([publishPromise, closePromise]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('drains an accepted saga dispatch suspended in discovery before shutdown clears state', async () => {
    const discoverySuspended = createDeferred<void>();
    const releaseDiscovery = createDeferred<void>();

    class DiscoveryRaceEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const sagaBus = await app.container.resolve(CqrsSagaLifecycleService);
    const ensureDiscovered = sagaBus['ensureDiscovered'].bind(sagaBus);

    sagaBus['ensureDiscovered'] = async (): Promise<void> => {
      discoverySuspended.resolve();
      await releaseDiscovery.promise;
      await ensureDiscovered();
    };

    const dispatchPromise = sagaBus.dispatch(new DiscoveryRaceEvent('suspended-discovery'));
    await discoverySuspended.promise;

    const suspendedSnapshot = sagaBus.getRuntimeSnapshot();
    const closePromise = app.close();

    try {
      expect(suspendedSnapshot.inFlightSagaExecutions).toBe(1);
      expect(sagaBus.getRuntimeSnapshot().inFlightSagaExecutions).toBe(1);
    } finally {
      releaseDiscovery.resolve();
      await Promise.allSettled([dispatchPromise, closePromise]);
    }

    expect(sagaBus.getRuntimeSnapshot()).toEqual({
      discovered: false,
      inFlightSagaExecutions: 0,
      lifecycleState: 'stopped',
      sagasDiscovered: 0,
      shutdownDrainTimeouts: 0,
    });
  });

  it('shares one drain window between CQRS event and saga shutdown hooks', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const releaseSaga = createDeferred<void>();
    const sagaStarted = createDeferred<void>();

    class SagaDeadlineEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Saga(SagaDeadlineEvent)
    class StuckDeadlineSaga implements ISaga<SagaDeadlineEvent> {
      async handle(): Promise<void> {
        sagaStarted.resolve();
        await releaseSaga.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ shutdown: { drainTimeoutMs: DRAIN_TIMEOUT_MS } })],
      providers: [StuckDeadlineSaga],
    });

    const app = await bootstrapApplication({ logger: createLogger(loggerEvents), rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const publishPromise = eventBus.publish(new SagaDeadlineEvent('saga-stuck'));

    await sagaStarted.promise;

    const closePromise = app.close();

    try {
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);
      await closePromise;
    } finally {
      releaseSaga.resolve();
      await vi.runAllTimersAsync();
      await Promise.allSettled([publishPromise, closePromise]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('reports degraded status counters for both stuck handler and saga drains', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const releaseHandler = createDeferred<void>();
    const releaseSaga = createDeferred<void>();
    const handlerStarted = createDeferred<void>();
    const sagaStarted = createDeferred<void>();

    class DegradedHandlerEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class DegradedSagaEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @EventHandler(DegradedHandlerEvent)
    class StuckDegradedHandler implements IEventHandler<DegradedHandlerEvent> {
      async handle(): Promise<void> {
        handlerStarted.resolve();
        await releaseHandler.promise;
      }
    }

    @Saga(DegradedSagaEvent)
    class StuckDegradedSaga implements ISaga<DegradedSagaEvent> {
      async handle(): Promise<void> {
        sagaStarted.resolve();
        await releaseSaga.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ shutdown: { drainTimeoutMs: DRAIN_TIMEOUT_MS } })],
      providers: [StuckDegradedHandler, StuckDegradedSaga],
    });

    const app = await bootstrapApplication({ logger: createLogger(loggerEvents), rootModule: AppModule });
    const cqrsEventBus = await app.container.resolve(CqrsEventBusService);
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const handlerPublishPromise = eventBus.publish(new DegradedHandlerEvent('degraded-handler'));
    const sagaPublishPromise = eventBus.publish(new DegradedSagaEvent('degraded-saga'));

    await handlerStarted.promise;
    await sagaStarted.promise;

    const closePromise = app.close();

    try {
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS);
      await closePromise;

      const cleanup = Promise.allSettled([handlerPublishPromise, sagaPublishPromise]);
      releaseHandler.resolve();
      releaseSaga.resolve();
      await cleanup;

      const snapshot = cqrsEventBus.createPlatformStatusSnapshot();

      expect(snapshot.details.shutdownDrainTimeouts).toBe(1);
      expect(snapshot.details.sagaShutdownDrainTimeouts).toBe(1);
      expect(snapshot.health.status).toBe('degraded');
      expect(snapshot.details.shutdownDrainTimeoutMs).toBe(DRAIN_TIMEOUT_MS);
      expect(loggerEvents).toEqual([
        'warn:CqrsEventBusService:CQRS event shutdown drain exceeded 20ms with 2 active publish pipeline(s); continuing shutdown.',
        'warn:CqrsSagaLifecycleService:CQRS saga shutdown drain exceeded 0ms with 1 active saga task(s); continuing shutdown.',
        'warn:EventBusLifecycleService:EventBus.publish() was ignored because the event bus is stopped.',
      ]);
    } finally {
      releaseHandler.resolve();
      releaseSaga.resolve();
      await vi.runAllTimersAsync();
      await Promise.allSettled([handlerPublishPromise, sagaPublishPromise, closePromise]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
