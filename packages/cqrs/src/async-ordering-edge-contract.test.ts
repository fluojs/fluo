import { Inject } from '@fluojs/core';
import { OnEvent } from '@fluojs/event-bus';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { EventHandler, Saga } from './decorators.js';
import { CqrsModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { CqrsEventBus, IEvent, IEventHandler, ISaga } from './types.js';

function createDeferred<T = void>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

describe('CQRS asynchronous ordering contracts', () => {
  it('awaits each pending handler, saga, and delegated stage before the next publishAll event', async () => {
    // Given
    class StageStore {
      readonly steps: string[] = [];
    }

    class StagedEvent implements IEvent {
      constructor(public readonly index: number) {}
    }

    const stages = ['handler', 'saga', 'delegated'] as const;
    type Stage = (typeof stages)[number];
    const gates: Record<Stage, { readonly started: ReturnType<typeof createDeferred<void>>; readonly release: ReturnType<typeof createDeferred<void>> }> = {
      delegated: { started: createDeferred<void>(), release: createDeferred<void>() },
      handler: { started: createDeferred<void>(), release: createDeferred<void>() },
      saga: { started: createDeferred<void>(), release: createDeferred<void>() },
    };

    const runStage = async (store: StageStore, stage: Stage, index: number): Promise<void> => {
      store.steps.push(`${stage}:start:${String(index)}`);

      if (index === 1) {
        gates[stage].started.resolve();
        await gates[stage].release.promise;
      }

      store.steps.push(`${stage}:end:${String(index)}`);
    };

    @Inject(StageStore)
    @EventHandler(StagedEvent)
    class StagedHandler implements IEventHandler<StagedEvent> {
      constructor(private readonly store: StageStore) {}

      async handle(event: StagedEvent): Promise<void> {
        await runStage(this.store, 'handler', event.index);
      }
    }

    @Inject(StageStore)
    @Saga(StagedEvent)
    class StagedSaga implements ISaga<StagedEvent> {
      constructor(private readonly store: StageStore) {}

      async handle(event: StagedEvent): Promise<void> {
        await runStage(this.store, 'saga', event.index);
      }
    }

    @Inject(StageStore)
    class StagedSubscriber {
      constructor(private readonly store: StageStore) {}

      @OnEvent(StagedEvent)
      async handle(event: StagedEvent): Promise<void> {
        await runStage(this.store, 'delegated', event.index);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: true } } })],
      providers: [StageStore, StagedHandler, StagedSaga, StagedSubscriber],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(StageStore);

    try {
      // When
      const publishing = eventBus.publishAll([new StagedEvent(1), new StagedEvent(2)]);
      const observedPrefixes: string[][] = [];

      for (const stage of stages) {
        await gates[stage].started.promise;
        observedPrefixes.push([...store.steps]);
        gates[stage].release.resolve();
      }

      await publishing;

      // Then
      expect(observedPrefixes).toEqual([
        ['handler:start:1'],
        ['handler:start:1', 'handler:end:1', 'saga:start:1'],
        ['handler:start:1', 'handler:end:1', 'saga:start:1', 'saga:end:1', 'delegated:start:1'],
      ]);
      expect(store.steps).toEqual([
        'handler:start:1',
        'handler:end:1',
        'saga:start:1',
        'saga:end:1',
        'delegated:start:1',
        'delegated:end:1',
        'handler:start:2',
        'handler:end:2',
        'saga:start:2',
        'saga:end:2',
        'delegated:start:2',
        'delegated:end:2',
      ]);
    } finally {
      for (const stage of stages) {
        gates[stage].release.resolve();
      }

      await app.close();
    }
  });

  it('keeps publishAll pending until the final delegated stage settles', async () => {
    // Given
    class TailStore {
      readonly steps: string[] = [];
    }

    class TailEvent implements IEvent {
      constructor(public readonly index: number) {}
    }

    const finalDelegatedStarted = createDeferred<void>();
    const releaseFinalDelegated = createDeferred<void>();

    @Inject(TailStore)
    @EventHandler(TailEvent)
    class TailHandler implements IEventHandler<TailEvent> {
      constructor(private readonly store: TailStore) {}

      handle(event: TailEvent): void {
        this.store.steps.push(`handler:${String(event.index)}`);
      }
    }

    @Inject(TailStore)
    class TailSubscriber {
      constructor(private readonly store: TailStore) {}

      @OnEvent(TailEvent)
      async handle(event: TailEvent): Promise<void> {
        this.store.steps.push(`delegated:start:${String(event.index)}`);

        if (event.index === 2) {
          finalDelegatedStarted.resolve();
          await releaseFinalDelegated.promise;
        }

        this.store.steps.push(`delegated:end:${String(event.index)}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: true } } })],
      providers: [TailStore, TailHandler, TailSubscriber],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(TailStore);

    try {
      // When
      const publishing = eventBus.publishAll([new TailEvent(1), new TailEvent(2)]);
      let publishingCompleted = false;
      void publishing.then(() => {
        publishingCompleted = true;
      });
      await finalDelegatedStarted.promise;
      await Promise.resolve();
      const completionBeforeRelease = publishingCompleted;

      releaseFinalDelegated.resolve();
      await publishing;

      // Then
      expect(completionBeforeRelease).toBe(false);
      expect(publishingCompleted).toBe(true);
      expect(store.steps).toEqual([
        'handler:1',
        'delegated:start:1',
        'delegated:end:1',
        'handler:2',
        'delegated:start:2',
        'delegated:end:2',
      ]);
    } finally {
      releaseFinalDelegated.resolve();
      await app.close();
    }
  });
});
