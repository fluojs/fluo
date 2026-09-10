import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { EVENT_BUS, EventBusLifecycleService, EventBusModule, type EventBusWithResults, OnEvent } from './index.js';

class RecordedEvent {
  constructor(readonly secret: string) {}
}

describe('explicit event publication results', () => {
  it('reports each handler settlement without cancelling a successful sibling', async () => {
    // Given
    const received: string[] = [];
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    class FailingHandler {
      @OnEvent(RecordedEvent)
      handle(event: RecordedEvent) {
        throw new Error(event.secret);
      }
    }
    class SuccessfulHandler {
      @OnEvent(RecordedEvent)
      handle(event: RecordedEvent) {
        received.push(event.secret);
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [FailingHandler, SuccessfulHandler],
    });
    const app = await FluoFactory.create(AppModule, { logger });
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);

      // When
      const result = await bus.publishWithResult(new RecordedEvent('payload-secret'));

      // Then
      expect(result).toEqual({
        status: 'settled',
        outcomes: [
          {
            target: { kind: 'handler', index: 0, moduleName: 'AppModule', targetName: 'FailingHandler', methodName: 'handle' },
            status: 'failed',
            reason: 'handler',
          },
          {
            target: { kind: 'handler', index: 1, moduleName: 'AppModule', targetName: 'SuccessfulHandler', methodName: 'handle' },
            status: 'succeeded',
          },
        ],
      });
      expect(received).toEqual(['payload-secret']);
      expect(JSON.stringify(result)).not.toContain('payload-secret');
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        'Event handler FailingHandler.handle failed.', undefined, 'EventBusLifecycleService',
      );
    } finally {
      await app.close();
    }
  });

  it('reports deduplicated inherited transport channels and distinct effective handlers with isolated payloads', async () => {
    // Given
    class BaseEvent {
      static readonly eventKey: string = 'base.v1';
      constructor(readonly meta: { value: string }) {}
    }
    class ChildEvent extends BaseEvent {
      static readonly eventKey = 'child.v1';
    }
    const seen: string[] = [];
    const logger = { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    class Handler {
      @OnEvent(BaseEvent)
      handle(event: BaseEvent) {
        seen.push(event.meta.value);
        event.meta.value = 'handler-mutated';
      }
    }
    const winner = Symbol('winner');
    class ReplacedHandler {
      @OnEvent(BaseEvent)
      handle() { throw new Error('Replaced provider must not execute'); }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({
        transport: {
          async publish(channel, payload) {
            if (!(payload instanceof ChildEvent)) throw new Error('Expected rehydrated child event');
            seen.push(payload.meta.value);
            payload.meta.value = 'transport-mutated';
            if (channel === 'child.v1') throw new Error('payload-secret');
          },
          async subscribe() {},
          async close() {},
        },
      })],
      providers: [
        { provide: winner, useClass: ReplacedHandler },
        { provide: winner, useClass: Handler },
        { provide: Symbol('other'), useClass: Handler },
      ],
    });
    const app = await FluoFactory.create(AppModule, { logger });
    try {
      const facade = await app.container.resolve<EventBusWithResults>(EVENT_BUS);
      const bus = await app.container.resolve(EventBusLifecycleService);
      const event = new ChildEvent({ value: 'original' });

      // When
      const result = await facade.publishWithResult(event);

      // Then
      expect(result).toMatchObject({
        status: 'settled',
        outcomes: [
          { target: { kind: 'handler', index: 0, targetName: 'Handler' }, status: 'succeeded' },
          { target: { kind: 'handler', index: 1, targetName: 'Handler' }, status: 'succeeded' },
          { target: { kind: 'transport', channel: 'child.v1' }, status: 'failed', reason: 'transport' },
          { target: { kind: 'transport', channel: 'base.v1' }, status: 'succeeded' },
        ],
      });
      expect(seen).toEqual(['original', 'original', 'original', 'original']);
      expect(event.meta.value).toBe('original');
      expect(bus.createPlatformStatusSnapshot().details.transportPublishFailures).toBe(1);
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        'EventBusTransport failed to publish to channel "child.v1".', undefined, 'EventBusLifecycleService',
      );
      expect(JSON.stringify(result)).not.toContain('payload-secret');
    } finally {
      await app.close();
    }
  });

  it.each([true, false])('reports no recipients instead of vacuous success with waitForHandlers=%s', async (waitForHandlers) => {
    // Given
    class AppModule {}
    defineModule(AppModule, { imports: [EventBusModule.forRoot()] });
    const app = await FluoFactory.create(AppModule);
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);

      // When
      const receipt = await bus.publishWithResult(new RecordedEvent('secret'), { waitForHandlers });
      const result = receipt.status === 'background' ? await receipt.completion : receipt;

      // Then
      expect(result).toEqual({ status: 'no-recipients', outcomes: [] });
    } finally {
      await app.close();
    }
  });

  it('does not claim that an uncallable discovered handler succeeded', async () => {
    // Given
    class Handler {
      @OnEvent(RecordedEvent)
      handle() {}
    }
    class AppModule {}
    defineModule(AppModule, { imports: [EventBusModule.forRoot()], providers: [Handler] });
    const app = await FluoFactory.create(AppModule);
    try {
      const bus = await app.container.resolve(EventBusLifecycleService);
      Reflect.set(await app.container.resolve(Handler), 'handle', undefined);

      // When
      const result = await bus.publishWithResult(new RecordedEvent('secret'));

      // Then
      expect(result).toMatchObject({ status: 'settled', outcomes: [{ status: 'failed', reason: 'not-callable' }] });
    } finally {
      await app.close();
    }
  });
});
