import { describe, expect, it } from 'vitest';

import { Inject, Scope } from '@konekti/core';
import { defineControllerMetadata } from '@konekti/core/internal';
import { Container } from '@konekti/di';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

import { OnEvent } from './decorators.js';
import { getEventHandlerMetadataEntries } from './metadata.js';
import { EventBusModule } from './module.js';
import { EventBusLifecycleService } from './service.js';
import { EVENT_BUS } from './tokens.js';
import type { EventBus, EventBusTransport } from './types.js';

function createLogger(events: string[]): ApplicationLogger {
  return {
    debug(message: string, context?: string) {
      events.push(`debug:${context ?? 'none'}:${message}`);
    },
    error(message: string, error?: unknown, context?: string) {
      events.push(`error:${context ?? 'none'}:${message}:${error instanceof Error ? error.message : 'none'}`);
    },
    log(message: string, context?: string) {
      events.push(`log:${context ?? 'none'}:${message}`);
    },
    warn(message: string, context?: string) {
      events.push(`warn:${context ?? 'none'}:${message}`);
    },
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

class UserCreatedEvent {
  constructor(public readonly userId: string) {}
}

class UserPromotedEvent extends UserCreatedEvent {
  constructor(userId: string, public readonly role: string) {
    super(userId);
  }
}

class PasswordResetEvent {
  constructor(public readonly userId: string) {}
}

describe('@konekti/event-bus', () => {
  it('writes event metadata from @OnEvent() using standard decorators', () => {
    class EventHandler {
      @OnEvent(UserCreatedEvent)
      handle(_event: UserCreatedEvent) {}
    }

    const entries = getEventHandlerMetadataEntries(EventHandler.prototype);

    expect(entries).toEqual([
      {
        metadata: {
          eventType: UserCreatedEvent,
        },
        propertyKey: 'handle',
      },
    ]);
  });

  it('rejects private methods annotated with @OnEvent()', () => {
    const decorator = OnEvent(UserCreatedEvent);

    expect(() => {
      decorator(() => undefined, {
        metadata: {},
        name: 'hiddenHandler',
        private: true,
      } as ClassMethodDecoratorContext);
    }).toThrow('@OnEvent() cannot be used on private methods.');
  });

  it('rejects static methods annotated with @OnEvent()', () => {
    const decorator = OnEvent(UserCreatedEvent);

    expect(() => {
      decorator(() => undefined, {
        metadata: {},
        name: 'staticHandler',
        private: false,
        static: true,
      } as ClassMethodDecoratorContext);
    }).toThrow('@OnEvent() cannot be used on static methods.');
  });

  it('dispatches a published event to a single provider handler with a rehydrated event instance', async () => {
    class EventStore {
      received: UserCreatedEvent | undefined;
    }

    @Inject([EventStore])
    class UserCreatedHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      async handle(event: UserCreatedEvent) {
        this.store.received = event;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, UserCreatedHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);
    const event = new UserCreatedEvent('user-1');

    await eventBus.publish(event);

    expect(store.received).toBeInstanceOf(UserCreatedEvent);
    expect(store.received).not.toBe(event);
    expect(store.received?.userId).toBe(event.userId);

    await app.close();
  });

  it('dispatches to multiple handlers and isolates handler failures without propagating to publisher', async () => {
    const loggerEvents: string[] = [];

    class EventStore {
      successCalls = 0;
    }

    @Inject([EventStore])
    class SuccessfulHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      handle(_event: UserCreatedEvent) {
        this.store.successCalls += 1;
      }
    }

    class FailingHandler {
      @OnEvent(UserCreatedEvent)
      handle(_event: UserCreatedEvent) {
        throw new Error('handler failed');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, SuccessfulHandler, FailingHandler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await expect(eventBus.publish(new UserCreatedEvent('user-2'))).resolves.toBeUndefined();

    expect(store.successCalls).toBe(1);
    expect(loggerEvents.some((event) => event.includes('Event handler FailingHandler.handle failed.'))).toBe(true);

    await app.close();
  });

  it('isolates payload mutations between local handlers and transport publish', async () => {
    const transport = {
      published: [] as Array<{ channel: string; payload: unknown }>,
      async publish(channel: string, payload: unknown) {
        this.published.push({ channel, payload });
      },
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
      async close() {},
    } satisfies EventBusTransport & { published: Array<{ channel: string; payload: unknown }> };

    class MutableEvent {
      constructor(public readonly meta: { role: string }) {}
    }

    class EventStore {
      firstSeen = '';
      secondSeen = '';
    }

    @Inject([EventStore])
    class FirstHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(MutableEvent)
      handle(event: MutableEvent) {
        this.store.firstSeen = event.meta.role;
        event.meta.role = 'mutated';
      }
    }

    @Inject([EventStore])
    class SecondHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(MutableEvent)
      handle(event: MutableEvent) {
        this.store.secondSeen = event.meta.role;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ transport })],
      providers: [EventStore, FirstHandler, SecondHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await eventBus.publish(new MutableEvent({ role: 'original' }));

    expect(store.firstSeen).toBe('original');
    expect(store.secondSeen).toBe('original');
    expect(transport.published).toHaveLength(1);
    expect((transport.published[0]?.payload as { meta: { role: string } }).meta.role).toBe('original');

    await app.close();
  });

  it('keeps publish bounded and predictable with mixed success, failure, and hanging handlers', async () => {
    const loggerEvents: string[] = [];
    const gate = createDeferred<void>();

    class EventStore {
      successCalls = 0;
    }

    @Inject([EventStore])
    class SuccessHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.successCalls += 1;
      }
    }

    class FailingHandler {
      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        throw new Error('handler failed');
      }
    }

    class HangingHandler {
      @OnEvent(UserCreatedEvent)
      async onUserCreated(_event: UserCreatedEvent) {
        await gate.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ publish: { timeoutMs: 20 } })],
      providers: [EventStore, SuccessHandler, FailingHandler, HangingHandler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await expect(eventBus.publish(new UserCreatedEvent('user-2-timeout'))).resolves.toBeUndefined();

    expect(store.successCalls).toBe(1);
    expect(loggerEvents.some((event) => event.includes('Event handler FailingHandler.onUserCreated failed.'))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('exceeded publish timeout of 20ms.'))).toBe(true);

    gate.resolve();
    await app.close();
  });

  it('supports non-blocking publish option without waiting for handler completion', async () => {
    const gate = createDeferred<void>();

    class EventStore {
      completedCalls = 0;
      startedCalls = 0;
    }

    @Inject([EventStore])
    class SlowHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      async onUserCreated(_event: UserCreatedEvent) {
        this.store.startedCalls += 1;
        await gate.promise;
        this.store.completedCalls += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, SlowHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await expect(
      eventBus.publish(new UserCreatedEvent('user-non-blocking'), { waitForHandlers: false }),
    ).resolves.toBeUndefined();

    await Promise.resolve();

    expect(store.startedCalls).toBe(1);
    expect(store.completedCalls).toBe(0);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.completedCalls).toBe(1);

    await app.close();
  });

  it('does not apply timeout bounds when publish is non-blocking', async () => {
    const loggerEvents: string[] = [];
    const gate = createDeferred<void>();

    class EventStore {
      startedCalls = 0;
    }

    @Inject([EventStore])
    class SlowHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      async onUserCreated(_event: UserCreatedEvent) {
        this.store.startedCalls += 1;
        await gate.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ publish: { timeoutMs: 10, waitForHandlers: false } })],
      providers: [EventStore, SlowHandler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await expect(eventBus.publish(new UserCreatedEvent('user-non-blocking-timeout'))).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.startedCalls).toBe(1);
    expect(loggerEvents.some((event) => event.includes('exceeded publish timeout'))).toBe(false);

    gate.resolve();
    await app.close();
  });

  it('supports publish cancellation signal before handler dispatch', async () => {
    const loggerEvents: string[] = [];

    class EventStore {
      calls = 0;
    }

    @Inject([EventStore])
    class Handler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.calls += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, Handler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);
    const controller = new AbortController();

    controller.abort();

    await expect(
      eventBus.publish(new UserCreatedEvent('user-cancelled'), { signal: controller.signal }),
    ).resolves.toBeUndefined();

    expect(store.calls).toBe(0);
    expect(
      loggerEvents.some((event) =>
        event.includes('Event publish was cancelled before dispatching handler Handler.onUserCreated.'),
      ),
    ).toBe(true);

    await app.close();
  });

  it('discovers handlers across imported modules from providers and controllers', async () => {
    class EventStore {
      providerCalls = 0;
      controllerCalls = 0;
    }

    @Inject([EventStore])
    class ImportedProviderHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.providerCalls += 1;
      }
    }

    @Inject([EventStore])
    class ImportedControllerHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.controllerCalls += 1;
      }
    }

    defineControllerMetadata(ImportedControllerHandler, { basePath: '/event-bus-test' });

    class FeatureModule {}
    defineModule(FeatureModule, {
      controllers: [ImportedControllerHandler],
      providers: [EventStore, ImportedProviderHandler],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FeatureModule, EventBusModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await eventBus.publish(new UserCreatedEvent('user-3'));

    expect(store.providerCalls).toBe(1);
    expect(store.controllerCalls).toBe(1);

    await app.close();
  });

  it('matches handlers by class inheritance so base handlers receive derived events', async () => {
    class EventStore {
      seenUserId = '';
    }

    @Inject([EventStore])
    class BaseEventHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onBaseEvent(event: UserCreatedEvent) {
        this.store.seenUserId = event.userId;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, BaseEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await eventBus.publish(new UserPromotedEvent('user-4', 'admin'));

    expect(store.seenUserId).toBe('user-4');

    await app.close();
  });

  it('is a no-op when no handlers match the published event', async () => {
    const loggerEvents: string[] = [];

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

    await expect(eventBus.publish(new PasswordResetEvent('user-5'))).resolves.toBeUndefined();
    expect(loggerEvents.some((event) => event.includes('error:EventBusLifecycleService'))).toBe(false);

    await app.close();
  });

  it('supports DI injection of EVENT_BUS into providers', async () => {
    class EventStore {
      count = 0;
    }

    @Inject([EventStore])
    class UserCreatedHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.count += 1;
      }
    }

    @Inject([EVENT_BUS])
    class UserPublisher {
      constructor(private readonly eventBus: EventBus) {}

      async emit(): Promise<void> {
        await this.eventBus.publish(new UserCreatedEvent('user-6'));
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, UserCreatedHandler, UserPublisher],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const publisher = await app.container.resolve(UserPublisher);
    const store = await app.container.resolve(EventStore);

    await publisher.emit();

    expect(store.count).toBe(1);

    await app.close();
  });

  it('deduplicates duplicate handler registration for the same token and method', async () => {
    class SharedHandler {
      static calls = 0;

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        SharedHandler.calls += 1;
      }
    }

    SharedHandler.calls = 0;

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [SharedHandler],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FeatureModule, EventBusModule.forRoot()],
      providers: [SharedHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

    await eventBus.publish(new UserCreatedEvent('user-7'));

    expect(SharedHandler.calls).toBe(1);

    await app.close();
  });

  it('warns and skips handlers declared on non-singleton providers and controllers', async () => {
    const loggerEvents: string[] = [];

    @Scope('request')
    class RequestScopedProvider {
      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {}
    }

    @Scope('transient')
    class TransientController {
      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {}
    }

    defineControllerMetadata(TransientController, { basePath: '/event-bus-scope' });

    class AppModule {}
    defineModule(AppModule, {
      controllers: [TransientController],
      imports: [EventBusModule.forRoot()],
      providers: [RequestScopedProvider],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

    await eventBus.publish(new UserCreatedEvent('user-8'));

    const requestWarnings = loggerEvents.filter((event) =>
      event.includes(
        'warn:EventBusLifecycleService:RequestScopedProvider in module AppModule declares @OnEvent() methods but is registered with request scope.',
      ),
    );
    const controllerWarnings = loggerEvents.filter((event) =>
      event.includes(
        'warn:EventBusLifecycleService:TransientController in module AppModule declares @OnEvent() methods but is registered with transient scope.',
      ),
    );

    expect(requestWarnings).toHaveLength(1);
    expect(controllerWarnings).toHaveLength(1);

    await app.close();
  });

  it('warns when publish() is called before onApplicationBootstrap has run', async () => {
    const loggerEvents: string[] = [];
    const logger = createLogger(loggerEvents);
    const container = new Container();
    const service = new EventBusLifecycleService(container, [], logger, {});

    await service.publish(new UserCreatedEvent('user-9'));

    expect(
      loggerEvents.some((e) =>
        e.includes('warn:EventBusLifecycleService') &&
        e.includes('called before onApplicationBootstrap'),
      ),
    ).toBe(true);
  });

  it('deduplicates handlers when the same class is registered under two different tokens', async () => {
    class EventStore {
      calls = 0;
    }

    const ALIAS_TOKEN = Symbol('AliasToken');

    @Inject([EventStore])
    class MultiTokenHandler {
      constructor(private readonly store: EventStore) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(_event: UserCreatedEvent) {
        this.store.calls += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [
        EventStore,
        MultiTokenHandler,
        { provide: ALIAS_TOKEN, useClass: MultiTokenHandler },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await eventBus.publish(new UserCreatedEvent('user-10'));

    expect(store.calls).toBe(1);

    await app.close();
  });

  it('keeps distinct handlers with colliding class and method names', async () => {
    class EventStore {
      firstCalls = 0;
      secondCalls = 0;
    }

    const FirstCollidingHandler = (() => {
      @Inject([EventStore])
      class CollidingHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {
          this.store.firstCalls += 1;
        }
      }

      return CollidingHandler;
    })();

    const SecondCollidingHandler = (() => {
      @Inject([EventStore])
      class CollidingHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {
          this.store.secondCalls += 1;
        }
      }

      return CollidingHandler;
    })();

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot()],
      providers: [EventStore, FirstCollidingHandler, SecondCollidingHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await eventBus.publish(new UserCreatedEvent('user-11'));

    expect(store.firstCalls).toBe(1);
    expect(store.secondCalls).toBe(1);

    await app.close();
  });

  describe('transport', () => {
    function createMockTransport(): EventBusTransport & {
      published: Array<{ channel: string; payload: unknown }>;
      subscribed: Array<{ channel: string; handler: (payload: unknown) => Promise<void> }>;
      closeCalls: number;
    } {
      const published: Array<{ channel: string; payload: unknown }> = [];
      const subscribed: Array<{ channel: string; handler: (payload: unknown) => Promise<void> }> = [];
      let closeCalls = 0;

      return {
        published,
        subscribed,
        get closeCalls() {
          return closeCalls;
        },
        async publish(channel, payload) {
          published.push({ channel, payload });
        },
        async subscribe(channel, handler) {
          subscribed.push({ channel, handler });
        },
        async close() {
          closeCalls += 1;
        },
      };
    }

    it('fans out to transport.publish() when transport is configured', async () => {
      const transport = createMockTransport();

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

      await eventBus.publish(new UserCreatedEvent('transport-user-1'));

      expect(transport.published).toHaveLength(1);
      expect(transport.published[0]!.channel).toBe('UserCreatedEvent');
      expect((transport.published[0]!.payload as { userId: string }).userId).toBe('transport-user-1');

      await app.close();
    });

    it('does not block on transport.publish() when waitForHandlers is false', async () => {
      const gate = createDeferred<void>();
      const transport = {
        publishCompleted: false,
        published: [] as Array<{ channel: string; payload: unknown }>,
        async publish(channel: string, payload: unknown) {
          this.published.push({ channel, payload });
          await gate.promise;
          this.publishCompleted = true;
        },
        async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
        async close() {},
      } satisfies EventBusTransport & {
        publishCompleted: boolean;
        published: Array<{ channel: string; payload: unknown }>;
      };

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);

      await expect(
        eventBus.publish(new UserCreatedEvent('transport-user-nowait'), { waitForHandlers: false }),
      ).resolves.toBeUndefined();

      expect(transport.published).toHaveLength(1);
      expect(transport.publishCompleted).toBe(false);

      gate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(transport.publishCompleted).toBe(true);

      await app.close();
    });

    it('subscribes to a channel per discovered local handler event type on bootstrap', async () => {
      const transport = createMockTransport();

      class HandlerA {
        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {}
      }

      class HandlerB {
        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {}
      }

      class HandlerC {
        @OnEvent(PasswordResetEvent)
        onPasswordReset(_event: PasswordResetEvent) {}
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [HandlerA, HandlerB, HandlerC],
      });

      await bootstrapApplication({ rootModule: AppModule });

      const subscribedChannels = transport.subscribed.map((s) => s.channel).sort();
      expect(subscribedChannels).toEqual(['PasswordResetEvent', 'UserCreatedEvent']);
    });

    it('fails bootstrap when transport subscription wiring fails', async () => {
      const loggerEvents: string[] = [];
      const transport = {
        async publish(_channel: string, _payload: unknown) {},
        async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {
          throw new Error('subscribe failed');
        },
        async close() {},
      } satisfies EventBusTransport;

      class Handler {
        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {}
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [Handler],
      });

      await expect(
        bootstrapApplication({ logger: createLogger(loggerEvents), rootModule: AppModule }),
      ).rejects.toThrow('subscribe failed');

      expect(
        loggerEvents.some((event) => event.includes('EventBusTransport failed to subscribe to channel "UserCreatedEvent".')),
      ).toBe(true);
    });

    it('dispatches incoming transport messages to local handlers', async () => {
      const transport = createMockTransport();

      class EventStore {
        received: UserCreatedEvent | undefined;
      }

      @Inject([EventStore])
      class TransportHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onUserCreated(event: UserCreatedEvent) {
          this.store.received = event;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, TransportHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const store = await app.container.resolve(EventStore);

      const incomingSubscription = transport.subscribed.find((s) => s.channel === 'UserCreatedEvent');
      expect(incomingSubscription).toBeDefined();

      await incomingSubscription!.handler({ userId: 'transport-user-2' });

      expect(store.received).toBeDefined();
      expect(store.received).toBeInstanceOf(UserCreatedEvent);
      expect(store.received!.userId).toBe('transport-user-2');

      await app.close();
    });

    it('isolates and logs handler failures for incoming transport messages', async () => {
      const transport = createMockTransport();
      const loggerEvents: string[] = [];

      class EventStore {
        successCalls = 0;
      }

      @Inject([EventStore])
      class SuccessfulTransportHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {
          this.store.successCalls += 1;
        }
      }

      class FailingTransportHandler {
        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {
          throw new Error('transport handler failed');
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, SuccessfulTransportHandler, FailingTransportHandler],
      });

      const app = await bootstrapApplication({
        logger: createLogger(loggerEvents),
        rootModule: AppModule,
      });
      const store = await app.container.resolve(EventStore);

      const incomingSubscription = transport.subscribed.find((entry) => entry.channel === 'UserCreatedEvent');
      expect(incomingSubscription).toBeDefined();

      await expect(incomingSubscription!.handler({ userId: 'transport-user-logged' })).resolves.toBeUndefined();

      expect(store.successCalls).toBe(1);
      expect(loggerEvents.some((event) => event.includes('Event handler FailingTransportHandler.onUserCreated failed.'))).toBe(true);

      await app.close();
    });

    it('keeps inherited handler matching consistent for transport messages', async () => {
      const transport = createMockTransport();

      class EventStore {
        baseCalls = 0;
        derivedCalls = 0;
      }

      @Inject([EventStore])
      class BaseHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onBase(_event: UserCreatedEvent) {
          this.store.baseCalls += 1;
        }
      }

      @Inject([EventStore])
      class DerivedHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserPromotedEvent)
        onDerived(_event: UserPromotedEvent) {
          this.store.derivedCalls += 1;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, BaseHandler, DerivedHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
      const store = await app.container.resolve(EventStore);

      await eventBus.publish(new UserPromotedEvent('transport-user-3', 'admin'));

      const publishedChannels = transport.published.map((entry) => entry.channel).sort();
      expect(publishedChannels).toEqual(['UserCreatedEvent', 'UserPromotedEvent']);

      const baseSubscription = transport.subscribed.find((entry) => entry.channel === 'UserCreatedEvent');
      const derivedSubscription = transport.subscribed.find((entry) => entry.channel === 'UserPromotedEvent');

      expect(baseSubscription).toBeDefined();
      expect(derivedSubscription).toBeDefined();

      await derivedSubscription!.handler({ userId: 'remote-derived', role: 'admin' });
      await baseSubscription!.handler({ userId: 'remote-derived', role: 'admin' });

      expect(store.baseCalls).toBe(2);
      expect(store.derivedCalls).toBe(2);

      await app.close();
    });

    it('uses explicit static eventKey values for transport channels', async () => {
      const transport = createMockTransport();

      class InventoryAdjustedEvent {
        static readonly eventKey = 'inventory.adjusted.v1';

        constructor(public readonly sku: string) {}
      }

      class EventStore {
        receivedSku = '';
      }

      @Inject([EventStore])
      class InventoryHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(InventoryAdjustedEvent)
        onAdjusted(event: InventoryAdjustedEvent) {
          this.store.receivedSku = event.sku;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, InventoryHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
      const store = await app.container.resolve(EventStore);

      await eventBus.publish(new InventoryAdjustedEvent('sku-1'));

      expect(transport.published).toHaveLength(1);
      expect(transport.published[0]!.channel).toBe('inventory.adjusted.v1');

      const incomingSubscription = transport.subscribed.find((entry) => entry.channel === 'inventory.adjusted.v1');
      expect(incomingSubscription).toBeDefined();

      await incomingSubscription!.handler({ sku: 'sku-2' });

      expect(store.receivedSku).toBe('sku-2');

      await app.close();
    });

    it('rehydrates incoming shared-channel payloads with each handler event type', async () => {
      const transport = createMockTransport();

      class BaseInventoryEvent {
        static readonly eventKey = 'inventory.shared.v1';

        constructor(public readonly sku: string) {}
      }

      class DetailedInventoryEvent extends BaseInventoryEvent {
        static readonly eventKey = 'inventory.shared.v1';

        constructor(sku: string, public readonly warehouse: string) {
          super(sku);
        }
      }

      class EventStore {
        baseEvent: BaseInventoryEvent | undefined;
        detailedEvent: DetailedInventoryEvent | undefined;
      }

      @Inject([EventStore])
      class BaseHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(BaseInventoryEvent)
        onBase(event: BaseInventoryEvent) {
          this.store.baseEvent = event;
        }
      }

      @Inject([EventStore])
      class DetailedHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(DetailedInventoryEvent)
        onDetailed(event: DetailedInventoryEvent) {
          this.store.detailedEvent = event;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, BaseHandler, DetailedHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const store = await app.container.resolve(EventStore);
      const incomingSubscription = transport.subscribed.find((entry) => entry.channel === 'inventory.shared.v1');

      expect(incomingSubscription).toBeDefined();

      await incomingSubscription!.handler({ sku: 'sku-2', warehouse: 'icn' });

      expect(store.baseEvent).toBeInstanceOf(BaseInventoryEvent);
      expect(store.detailedEvent).toBeInstanceOf(DetailedInventoryEvent);
      expect(store.detailedEvent?.warehouse).toBe('icn');

      await app.close();
    });

    it('isolates payload mutations between handlers for incoming transport messages', async () => {
      const transport = createMockTransport();

      class MutableTransportEvent {
        constructor(public readonly meta: { role: string }) {}
      }

      class EventStore {
        firstSeen = '';
        secondSeen = '';
      }

      @Inject([EventStore])
      class FirstHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(MutableTransportEvent)
        handle(event: MutableTransportEvent) {
          this.store.firstSeen = event.meta.role;
          event.meta.role = 'changed';
        }
      }

      @Inject([EventStore])
      class SecondHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(MutableTransportEvent)
        handle(event: MutableTransportEvent) {
          this.store.secondSeen = event.meta.role;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
        providers: [EventStore, FirstHandler, SecondHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const store = await app.container.resolve(EventStore);
      const incomingSubscription = transport.subscribed.find((s) => s.channel === 'MutableTransportEvent');

      expect(incomingSubscription).toBeDefined();
      await incomingSubscription!.handler({ meta: { role: 'original' } });

      expect(store.firstSeen).toBe('original');
      expect(store.secondSeen).toBe('original');

      await app.close();
    });

    it('calls transport.close() on application shutdown', async () => {
      const transport = createMockTransport();

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot({ transport })],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });

      expect(transport.closeCalls).toBe(0);
      await app.close();
      expect(transport.closeCalls).toBe(1);
    });

    it('does not call transport when no transport is configured (backward compat)', async () => {
      class EventStore {
        calls = 0;
      }

      @Inject([EventStore])
      class LocalHandler {
        constructor(private readonly store: EventStore) {}

        @OnEvent(UserCreatedEvent)
        onUserCreated(_event: UserCreatedEvent) {
          this.store.calls += 1;
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        imports: [EventBusModule.forRoot()],
        providers: [EventStore, LocalHandler],
      });

      const app = await bootstrapApplication({ rootModule: AppModule });
      const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
      const store = await app.container.resolve(EventStore);

      await eventBus.publish(new UserCreatedEvent('local-user'));

      expect(store.calls).toBe(1);

      await app.close();
    });
  });
});
