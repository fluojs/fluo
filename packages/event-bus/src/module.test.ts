import { describe, expect, it } from 'vitest';

import { Inject, Scope, defineControllerMetadata } from '@konekti/core';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

import { OnEvent } from './decorators.js';
import { getEventHandlerMetadataEntries } from './metadata.js';
import { createEventBusModule } from './module.js';
import { EVENT_BUS } from './tokens.js';
import type { EventBus } from './types.js';

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

  it('dispatches a published event to a single provider handler with the exact event instance', async () => {
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
      imports: [createEventBusModule()],
      providers: [EventStore, UserCreatedHandler],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);
    const event = new UserCreatedEvent('user-1');

    await eventBus.publish(event);

    expect(store.received).toBe(event);

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
      imports: [createEventBusModule()],
      providers: [EventStore, SuccessfulHandler, FailingHandler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      mode: 'test',
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<EventBus>(EVENT_BUS);
    const store = await app.container.resolve(EventStore);

    await expect(eventBus.publish(new UserCreatedEvent('user-2'))).resolves.toBeUndefined();

    expect(store.successCalls).toBe(1);
    expect(loggerEvents.some((event) => event.includes('Event handler FailingHandler.handle failed.'))).toBe(true);

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
      imports: [FeatureModule, createEventBusModule()],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
      imports: [createEventBusModule()],
      providers: [EventStore, BaseEventHandler],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
      imports: [createEventBusModule()],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      mode: 'test',
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
      imports: [createEventBusModule()],
      providers: [EventStore, UserCreatedHandler, UserPublisher],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
      imports: [FeatureModule, createEventBusModule()],
      providers: [SharedHandler],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
      imports: [createEventBusModule()],
      providers: [RequestScopedProvider],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      mode: 'test',
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
});
