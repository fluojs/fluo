import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Saga } from './decorators.js';
import { getSagaMetadata } from './metadata.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsEventBus, IEvent, ISaga } from './types.js';

describe('CQRS saga decorator boundary contracts', () => {
  const invalidSagaInputs: readonly (readonly [string, unknown])[] = [
    ['an empty event list', []],
    ['a null event input', null],
    ['a string event input', 'not-a-constructor'],
    ['a non-constructable callable event input', () => undefined],
    ['an event list containing a non-constructable value', [class ValidEvent implements IEvent {}, 'not-a-constructor']],
  ];

  it.each(invalidSagaInputs)('rejects %s when creating the decorator', (_scenario, invalidInput) => {
    // When
    const createDecorator = () => Reflect.apply(Saga, undefined, [invalidInput]);

    // Then
    expect(createDecorator).toThrow();
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
