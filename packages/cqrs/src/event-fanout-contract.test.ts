import { Inject, InvariantError } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { EventHandler, Saga } from './decorators.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsEventBus, IEvent, IEventHandler, ISaga } from './types.js';

describe('CQRS event fan-out contracts', () => {
  it('fans out one handler class through each distinct singleton provider token', async () => {
    // Given
    const FIRST_HANDLER = Symbol('FIRST_HANDLER');
    const SECOND_HANDLER = Symbol('SECOND_HANDLER');
    const seen: string[] = [];

    class AccountOpenedEvent implements IEvent {
      constructor(public readonly accountId: string) {}
    }

    @EventHandler(AccountOpenedEvent)
    class SharedAccountHandler implements IEventHandler<AccountOpenedEvent> {
      handle(event: AccountOpenedEvent): void {
        seen.push(event.accountId);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: FIRST_HANDLER, useClass: SharedAccountHandler },
        { provide: SECOND_HANDLER, useClass: SharedAccountHandler },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      await eventBus.publish(new AccountOpenedEvent('account-1'));

      // Then
      expect(seen).toEqual(['account-1', 'account-1']);
    } finally {
      await app.close();
    }
  });

  it('fans out one saga class through each distinct singleton provider token', async () => {
    // Given
    const FIRST_SAGA = Symbol('FIRST_SAGA');
    const SECOND_SAGA = Symbol('SECOND_SAGA');
    const seen: string[] = [];

    class AccountClosedEvent implements IEvent {
      constructor(public readonly accountId: string) {}
    }

    @Saga(AccountClosedEvent)
    class SharedAccountSaga implements ISaga<AccountClosedEvent> {
      handle(event: AccountClosedEvent): void {
        seen.push(event.accountId);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: FIRST_SAGA, useClass: SharedAccountSaga },
        { provide: SECOND_SAGA, useClass: SharedAccountSaga },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      await eventBus.publish(new AccountClosedEvent('account-2'));

      // Then
      expect(seen).toEqual(['account-2', 'account-2']);
    } finally {
      await app.close();
    }
  });

  it('awaits each full handler, saga, and delegated pipeline before the next publishAll event', async () => {
    // Given
    class PipelineStore {
      readonly steps: string[] = [];
    }

    class PipelineEvent implements IEvent {
      constructor(public readonly index: number) {}
    }

    @Inject(PipelineStore)
    @EventHandler(PipelineEvent)
    class PipelineHandler implements IEventHandler<PipelineEvent> {
      constructor(private readonly store: PipelineStore) {}

      handle(event: PipelineEvent): void {
        this.store.steps.push(`handler:${String(event.index)}`);
      }
    }

    @Inject(PipelineStore)
    @Saga(PipelineEvent)
    class PipelineSaga implements ISaga<PipelineEvent> {
      constructor(private readonly store: PipelineStore) {}

      handle(event: PipelineEvent): void {
        this.store.steps.push(`saga:${String(event.index)}`);
      }
    }

    @Inject(PipelineStore)
    class DelegatedSubscriber {
      constructor(private readonly store: PipelineStore) {}

      @OnEvent(PipelineEvent)
      handle(event: PipelineEvent): void {
        this.store.steps.push(`delegated:${String(event.index)}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: true } } })],
      providers: [PipelineStore, PipelineHandler, PipelineSaga, DelegatedSubscriber],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(PipelineStore);

    try {
      // When
      await eventBus.publishAll([new PipelineEvent(1), new PipelineEvent(2)]);

      // Then
      expect(store.steps).toEqual([
        'handler:1',
        'saga:1',
        'delegated:1',
        'handler:2',
        'saga:2',
        'delegated:2',
      ]);
    } finally {
      await app.close();
    }
  });

  it('rejects decorated event providers without handle(event)', async () => {
    // Given
    class InvalidEvent implements IEvent {}

    @EventHandler(InvalidEvent)
    class InvalidEventHandler {}

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [InvalidEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const publishing = eventBus.publish(new InvalidEvent());
      const error = await publishing.catch((caught: unknown) => caught);

      // Then
      expect(error).toBeInstanceOf(InvariantError);
      expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('must implement handle(event)') }));
    } finally {
      await app.close();
    }
  });

  it('rejects decorated saga providers without handle(event)', async () => {
    // Given
    class InvalidSagaEvent implements IEvent {}

    @Saga(InvalidSagaEvent)
    class InvalidSaga {}

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [InvalidSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    try {
      // When
      const publishing = eventBus.publish(new InvalidSagaEvent());
      const error = await publishing.catch((caught: unknown) => caught);

      // Then
      expect(error).toBeInstanceOf(InvariantError);
      expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('must implement handle(event)') }));
    } finally {
      await app.close();
    }
  });
});
