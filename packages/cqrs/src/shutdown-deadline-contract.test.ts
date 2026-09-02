import { OnEvent } from '@fluojs/event-bus';
import { type ApplicationLogger, bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CqrsEventBusService } from './buses/event-bus.js';
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

async function settleWithinOneDrainWindow(closePromise: Promise<void>, windowMs: number): Promise<'blocked' | 'settled'> {
  let settled = false;
  const observed = closePromise.then(() => {
    settled = true;
  });

  await vi.advanceTimersByTimeAsync(windowMs);
  await Promise.race([observed, Promise.resolve()]);

  return settled ? 'settled' : 'blocked';
}

describe('CQRS single shutdown deadline contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds a stuck delegated publish inside one CQRS drain window', async () => {
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
      imports: [CqrsModule.forRoot({ shutdown: { drainTimeoutMs: DRAIN_TIMEOUT_MS } })],
      providers: [StuckSubscriber],
    });

    const app = await bootstrapApplication({ logger: createLogger(loggerEvents), rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const publishPromise = eventBus.publish(new DelegatedEvent('delegated-stuck'));

    await subscriberStarted.promise;

    const closePromise = app.close();

    expect(await settleWithinOneDrainWindow(closePromise, DRAIN_TIMEOUT_MS)).toBe('settled');
    expect(loggerEvents.some((event) => event.includes(`exceeded ${String(DRAIN_TIMEOUT_MS)}ms`))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('exceeded 5000ms'))).toBe(false);

    releaseSubscriber.resolve();
    await publishPromise;
    await closePromise;
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

    expect(await settleWithinOneDrainWindow(closePromise, DRAIN_TIMEOUT_MS)).toBe('settled');

    releaseSaga.resolve();
    await publishPromise;
    await closePromise;
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
    void eventBus.publish(new DegradedHandlerEvent('degraded-handler'));
    void eventBus.publish(new DegradedSagaEvent('degraded-saga'));

    await handlerStarted.promise;
    await sagaStarted.promise;

    const closePromise = app.close();

    expect(await settleWithinOneDrainWindow(closePromise, DRAIN_TIMEOUT_MS)).toBe('settled');

    const snapshot = cqrsEventBus.createPlatformStatusSnapshot();

    expect(snapshot.details.shutdownDrainTimeouts).toBe(1);
    expect(snapshot.details.sagaShutdownDrainTimeouts).toBe(1);
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.details.shutdownDrainTimeoutMs).toBe(DRAIN_TIMEOUT_MS);

    await closePromise;
  });
});
