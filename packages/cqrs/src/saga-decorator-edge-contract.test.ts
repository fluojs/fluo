import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Saga } from './decorators.js';
import { getSagaMetadata } from './metadata.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsEventBus, IEvent, ISaga } from './types.js';

describe('CQRS saga decorator boundary contracts', () => {
  it('rejects empty and non-constructor event inputs when creating the decorator', () => {
    // When
    const emptyList = () => Saga([]);
    const nonConstructor = () => Reflect.apply(Saga, undefined, [null]);
    const nonConstructableCallable = () => Reflect.apply(Saga, undefined, [() => undefined]);
    const mixedList = () => Reflect.apply(Saga, undefined, [[class ValidEvent implements IEvent {}, 'not-a-constructor']]);

    // Then
    expect(emptyList).toThrowError('@Saga() requires at least one event type.');
    expect(nonConstructor).toThrowError('@Saga() event types must be class constructors.');
    expect(nonConstructableCallable).toThrowError('@Saga() event types must be class constructors.');
    expect(mixedList).toThrowError('@Saga() event types must be class constructors.');
  });

  it('deduplicates repeated event constructors into one saga invocation', async () => {
    // Given
    const handled: string[] = [];

    class RepeatedSagaEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Saga([RepeatedSagaEvent, RepeatedSagaEvent])
    class RepeatedEventSaga implements ISaga<RepeatedSagaEvent> {
      handle(event: RepeatedSagaEvent): void {
        handled.push(event.id);
      }
    }

    // Then
    expect(getSagaMetadata(RepeatedEventSaga)?.eventTypes).toEqual([RepeatedSagaEvent]);

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [RepeatedEventSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      await eventBus.publish(new RepeatedSagaEvent('saga-1'));

      // Then
      expect(handled).toEqual(['saga-1']);
    } finally {
      await app.close();
    }
  });
});
