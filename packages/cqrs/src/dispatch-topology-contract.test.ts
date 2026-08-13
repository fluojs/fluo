import { Inject, InvariantError } from '@fluojs/core';
import { Container } from '@fluojs/di';
import {
  type ApplicationLogger,
  bootstrapApplication,
  defineModule,
  type RuntimeCleanupRegistration,
} from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { Saga } from './decorators.js';
import { SagaExecutionError, SagaTopologyError } from './errors.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsDispatchContext, CqrsEventBus, IEvent, ISaga } from './types.js';

function createLogger(): ApplicationLogger {
  return {
    debug() {},
    error() {},
    log() {},
    warn() {},
  };
}

function createRuntimeCleanupRegistry(callbacks: Array<() => void>): RuntimeCleanupRegistration {
  return (cleanup: () => void) => {
    callbacks.push(cleanup);

    return () => {
      const index = callbacks.indexOf(cleanup);

      if (index >= 0) {
        callbacks.splice(index, 1);
      }
    };
  };
}

describe('CQRS dispatch topology contracts', () => {
  it('keeps dispatch context opaque and detects a cycle after attempted route mutation', async () => {
    // Given
    let contextFrozen = false;
    let contextKeys: readonly PropertyKey[] = [];

    class LoopEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class DecoyEvent implements IEvent {}

    @Inject(EVENT_BUS)
    @Saga(LoopEvent)
    class LoopSaga implements ISaga<LoopEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(event: LoopEvent, context?: CqrsDispatchContext): Promise<void> {
        if (!context) {
          throw new InvariantError('Expected CQRS to provide nested dispatch context.');
        }

        contextFrozen = Object.isFrozen(context);
        contextKeys = Reflect.ownKeys(context);
        Reflect.set(context, 'activeRoutes', [{ eventType: DecoyEvent, token: LoopSaga }]);
        await this.eventBus.publish(new LoopEvent(event.id), context);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [LoopSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const publishing = eventBus.publish(new LoopEvent('loop-1'));

      // Then
      await expect(publishing).rejects.toBeInstanceOf(SagaTopologyError);
      await expect(eventBus.publish(new LoopEvent('loop-2'))).rejects.toThrow('unsafe cycle');
      expect(contextFrozen).toBe(true);
      expect(contextKeys).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('serializes nested different-event dispatch for the same saga token without deadlocking', async () => {
    // Given
    let activeHandles = 0;
    let maximumActiveHandles = 0;
    const handledEvents: string[] = [];

    class FirstEvent implements IEvent {}

    class SecondEvent implements IEvent {}

    @Inject(EVENT_BUS)
    @Saga([FirstEvent, SecondEvent])
    class MultiRouteSaga implements ISaga<FirstEvent | SecondEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(event: FirstEvent | SecondEvent, context?: CqrsDispatchContext): Promise<void> {
        activeHandles += 1;
        maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
        handledEvents.push(`${event.constructor.name}:start`);

        try {
          if (event instanceof FirstEvent) {
            await this.eventBus.publish(new SecondEvent(), context);
          }
        } finally {
          handledEvents.push(`${event.constructor.name}:end`);
          activeHandles -= 1;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [MultiRouteSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      await eventBus.publish(new FirstEvent());

      // Then
      expect(handledEvents).toEqual([
        'FirstEvent:start',
        'FirstEvent:end',
        'SecondEvent:start',
        'SecondEvent:end',
      ]);
      expect(maximumActiveHandles).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('serializes inherited nested event routes that resolve to the same saga token', async () => {
    // Given
    let activeHandles = 0;
    let maximumActiveHandles = 0;
    const handledEvents: string[] = [];

    class TriggerEvent implements IEvent {}

    class ParentEvent implements IEvent {}

    class ChildEvent extends ParentEvent {}

    @Inject(EVENT_BUS)
    @Saga([TriggerEvent, ParentEvent, ChildEvent])
    class InheritedRouteSaga implements ISaga<TriggerEvent | ParentEvent | ChildEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(
        event: TriggerEvent | ParentEvent | ChildEvent,
        context?: CqrsDispatchContext,
      ): Promise<void> {
        activeHandles += 1;
        maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
        handledEvents.push(`${event.constructor.name}:start`);

        try {
          if (event instanceof TriggerEvent) {
            await this.eventBus.publish(new ChildEvent(), context);
          }

          await Promise.resolve();
        } finally {
          handledEvents.push(`${event.constructor.name}:end`);
          activeHandles -= 1;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [InheritedRouteSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      await eventBus.publish(new TriggerEvent());

      // Then
      expect(handledEvents).toEqual([
        'TriggerEvent:start',
        'TriggerEvent:end',
        'ParentEvent:start',
        'ParentEvent:end',
        'ChildEvent:start',
        'ChildEvent:end',
      ]);
      expect(maximumActiveHandles).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('cleans same-token continuation state after a nested saga failure', async () => {
    // Given
    let activeHandles = 0;
    let maximumActiveHandles = 0;
    const handledEvents: string[] = [];

    class ParentEvent implements IEvent {}

    class FailingContinuationEvent implements IEvent {}

    class RecoveryEvent implements IEvent {}

    @Inject(EVENT_BUS)
    @Saga([ParentEvent, FailingContinuationEvent, RecoveryEvent])
    class RecoverableSaga implements ISaga<ParentEvent | FailingContinuationEvent | RecoveryEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(
        event: ParentEvent | FailingContinuationEvent | RecoveryEvent,
        context?: CqrsDispatchContext,
      ): Promise<void> {
        activeHandles += 1;
        maximumActiveHandles = Math.max(maximumActiveHandles, activeHandles);
        handledEvents.push(event.constructor.name);

        try {
          if (event instanceof ParentEvent) {
            await this.eventBus.publish(new FailingContinuationEvent(), context);
          }

          if (event instanceof FailingContinuationEvent) {
            throw new Error('continuation failed');
          }
        } finally {
          activeHandles -= 1;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [RecoverableSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const failedPublishing = eventBus.publish(new ParentEvent());

      // Then
      await expect(failedPublishing).rejects.toBeInstanceOf(SagaExecutionError);
      await expect(eventBus.publish(new RecoveryEvent())).resolves.toBeUndefined();
      expect(handledEvents).toEqual(['ParentEvent', 'FailingContinuationEvent', 'RecoveryEvent']);
      expect(activeHandles).toBe(0);
      expect(maximumActiveHandles).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('enforces the depth limit after attempted depth mutation', async () => {
    // Given
    type EventConstructor = new () => IEvent;
    const eventTypes: EventConstructor[] = Array.from({ length: 33 }, (_, index) => {
      return class DepthEvent implements IEvent {
        readonly hop = index + 1;
      };
    });

    function createDepthSaga(EventType: EventConstructor, NextEventType: EventConstructor | undefined) {
      @Inject(EVENT_BUS)
      @Saga(EventType)
      class DepthSaga implements ISaga<IEvent> {
        constructor(private readonly eventBus: CqrsEventBus) {}

        async handle(_event: IEvent, context?: CqrsDispatchContext): Promise<void> {
          if (!context) {
            throw new InvariantError('Expected CQRS to provide nested dispatch context.');
          }

          Reflect.set(context, 'depth', 0);

          if (NextEventType) {
            await this.eventBus.publish(new NextEventType(), context);
          }
        }
      }

      return DepthSaga;
    }

    const sagaProviders = eventTypes.map((EventType, index) => {
      return createDepthSaga(EventType, eventTypes.at(index + 1));
    });
    const FirstEventType = eventTypes.at(0);

    if (!FirstEventType) {
      throw new InvariantError('Expected at least one depth event type.');
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: sagaProviders,
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const publishing = eventBus.publish(new FirstEventType());

      // Then
      await expect(publishing).rejects.toBeInstanceOf(SagaTopologyError);
      await expect(eventBus.publish(new FirstEventType())).rejects.toThrow('maximum nested saga depth of 32');
    } finally {
      await app.close();
    }
  });

  it('rejects a forged allowDuringShutdown dispatch option', async () => {
    // Given
    const cleanupCallbacks: Array<() => void> = [];
    class ShutdownEvent implements IEvent {}

    const sagaBus = new CqrsSagaLifecycleService(
      new Container(),
      [],
      createLogger(),
      {},
      createRuntimeCleanupRegistry(cleanupCallbacks),
    );
    await sagaBus.onApplicationBootstrap();

    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }

    // When
    const dispatching = Reflect.apply(sagaBus.dispatch, sagaBus, [
      new ShutdownEvent(),
      undefined,
      { allowDuringShutdown: true },
    ]);

    // Then
    await expect(dispatching).rejects.toBeInstanceOf(InvariantError);
  });
});
