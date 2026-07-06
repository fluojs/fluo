import { Inject, InvariantError } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { type EventBus, EVENT_BUS as FLUO_EVENT_BUS, type EventBusTransport, OnEvent } from '@fluojs/event-bus';
import { type ApplicationLogger, bootstrapApplication, defineModule, type OnApplicationShutdown, type RuntimeCleanupRegistration } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';
import { CommandBusLifecycleService } from './buses/command-bus.js';
import { CqrsEventBusService } from './buses/event-bus.js';
import { QueryBusLifecycleService } from './buses/query-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { CommandHandler, EventHandler, QueryHandler, Saga } from './decorators.js';
import {
  CommandHandlerNotFoundException,
  DuplicateCommandHandlerError,
  DuplicateQueryHandlerError,
  QueryHandlerNotFoundException,
  SagaExecutionError,
  SagaTopologyError,
} from './errors.js';
import { getCommandHandlerMetadata, getEventHandlerMetadata, getQueryHandlerMetadata, getSagaMetadata } from './metadata.js';
import { CqrsModule } from './module.js';
import { COMMAND_BUS, EVENT_BUS, QUERY_BUS } from './tokens.js';
import type {
  CommandBus,
  CqrsDispatchContext,
  CqrsEventBus,
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  ISaga,
  QueryBus,
} from './types.js';

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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function getPreloadedHandlerCount(service: object): number {
  const handlerInstances = Reflect.get(service, 'handlerInstances');

  if (!(handlerInstances instanceof Map)) {
    throw new Error('Expected CQRS service to expose a handlerInstances cache for package-internal tests.');
  }

  return handlerInstances.size;
}

function getPendingSagaDispatches(service: object): Set<Promise<void>> {
  const pendingDispatches = Reflect.get(service, 'pendingDispatches');

  if (!(pendingDispatches instanceof Set)) {
    throw new Error('Expected CQRS saga service to expose pendingDispatches for package-internal tests.');
  }

  return pendingDispatches;
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

class CreateUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class GetUserQuery implements IQuery<{ id: string; name: string | undefined }> {
  readonly __queryResultType__?: { id: string; name: string | undefined };

  constructor(public readonly id: string) {}
}

class GetUserCountQuery implements IQuery<number> {
  readonly __queryResultType__?: number;

  constructor(public readonly id: string) {}
}

class UserCreatedEvent implements IEvent {
  constructor(public readonly name: string) {}
}

describe('@fluojs/cqrs', () => {
  it('stores and reads class decorator metadata for command/query/event handlers and sagas', () => {
    @CommandHandler(CreateUserCommand)
    class CreateUserHandler {
      execute(_command: CreateUserCommand) {
        return undefined;
      }
    }

    @QueryHandler(GetUserQuery)
    class GetUserHandler {
      execute(_query: GetUserQuery) {
        return { id: 'x', name: 'user' };
      }
    }

    @EventHandler(UserCreatedEvent)
    class UserCreatedHandler {}

    @Saga([UserCreatedEvent])
    class UserCreatedSaga {
      handle(_event: UserCreatedEvent): void {}
    }

    class UndecoratedHandler {}

    expect(getCommandHandlerMetadata(CreateUserHandler)).toEqual({ commandType: CreateUserCommand });
    expect(getQueryHandlerMetadata(GetUserHandler)).toEqual({ queryType: GetUserQuery });
    expect(getEventHandlerMetadata(UserCreatedHandler)).toEqual({ eventType: UserCreatedEvent });
    expect(getSagaMetadata(UserCreatedSaga)).toEqual({ eventTypes: [UserCreatedEvent] });
    expect(getCommandHandlerMetadata(UndecoratedHandler)).toBeUndefined();
    expect(getQueryHandlerMetadata(UndecoratedHandler)).toBeUndefined();
    expect(getEventHandlerMetadata(UndecoratedHandler)).toBeUndefined();
    expect(getSagaMetadata(UndecoratedHandler)).toBeUndefined();
  });

  it('executes command and query handlers discovered at bootstrap', async () => {
    class Store {
      users = new Map<string, string>();
    }

    @Inject(Store)
    @CommandHandler(CreateUserCommand)
    class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      constructor(private readonly store: Store) {}

      execute(command: CreateUserCommand): string {
        this.store.users.set('1', command.name);
        return `created:${command.name}`;
      }
    }

    @Inject(Store)
    @QueryHandler(GetUserQuery)
    class GetUserHandler implements IQueryHandler<GetUserQuery, { id: string; name: string | undefined }> {
      constructor(private readonly store: Store) {}

      execute(query: GetUserQuery): { id: string; name: string | undefined } {
        return {
          id: query.id,
          name: this.store.users.get(query.id),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [Store, CreateUserHandler, GetUserHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    const created = await commandBus.execute<CreateUserCommand, string>(new CreateUserCommand('alice'));
    const found = await queryBus.execute<GetUserQuery, { id: string; name: string | undefined }>(new GetUserQuery('1'));

    expect(created).toBe('created:alice');
    expect(found).toEqual({ id: '1', name: 'alice' });

    await app.close();
  });

  it('ignores CQRS decorators on module controllers during handler discovery', async () => {
    const seen: string[] = [];

    @CommandHandler(CreateUserCommand)
    class ControllerCreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      execute(command: CreateUserCommand): string {
        return `controller-command:${command.name}`;
      }
    }

    @QueryHandler(GetUserQuery)
    class ControllerGetUserHandler implements IQueryHandler<GetUserQuery, { id: string; name: string | undefined }> {
      execute(query: GetUserQuery): { id: string; name: string | undefined } {
        return { id: query.id, name: 'controller-query' };
      }
    }

    @EventHandler(UserCreatedEvent)
    class ControllerEventHandler implements IEventHandler<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`controller-event:${event.name}`);
      }
    }

    @Saga(UserCreatedEvent)
    class ControllerSaga implements ISaga<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`controller-saga:${event.name}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [
        ControllerCreateUserHandler,
        ControllerGetUserHandler,
        ControllerEventHandler,
        ControllerSaga,
      ],
      imports: [CqrsModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(commandBus.execute(new CreateUserCommand('alice'))).rejects.toBeInstanceOf(CommandHandlerNotFoundException);
    await expect(queryBus.execute(new GetUserQuery('u-1'))).rejects.toBeInstanceOf(QueryHandlerNotFoundException);
    await eventBus.publish(new UserCreatedEvent('alice'));

    expect(seen).toEqual([]);

    await app.close();
  });

  it('skips non-singleton CQRS handlers and sagas with warnings', async () => {
    const loggerEvents: string[] = [];
    const seen: string[] = [];
    const COMMAND_HANDLER_TOKEN = Symbol('COMMAND_HANDLER_TOKEN');
    const QUERY_HANDLER_TOKEN = Symbol('QUERY_HANDLER_TOKEN');
    const EVENT_HANDLER_TOKEN = Symbol('EVENT_HANDLER_TOKEN');
    const SAGA_TOKEN = Symbol('SAGA_TOKEN');

    @CommandHandler(CreateUserCommand)
    class TransientCreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      execute(command: CreateUserCommand): string {
        return `transient-command:${command.name}`;
      }
    }

    @QueryHandler(GetUserQuery)
    class RequestGetUserHandler implements IQueryHandler<GetUserQuery, { id: string; name: string | undefined }> {
      execute(query: GetUserQuery): { id: string; name: string | undefined } {
        return { id: query.id, name: 'request-query' };
      }
    }

    @EventHandler(UserCreatedEvent)
    class TransientEventHandler implements IEventHandler<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`transient-event:${event.name}`);
      }
    }

    @Saga(UserCreatedEvent)
    class RequestSaga implements ISaga<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`request-saga:${event.name}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: COMMAND_HANDLER_TOKEN, scope: 'transient', useClass: TransientCreateUserHandler },
        { provide: QUERY_HANDLER_TOKEN, scope: 'request', useClass: RequestGetUserHandler },
        { provide: EVENT_HANDLER_TOKEN, scope: 'transient', useClass: TransientEventHandler },
        { provide: SAGA_TOKEN, scope: 'request', useClass: RequestSaga },
      ],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(commandBus.execute(new CreateUserCommand('alice'))).rejects.toBeInstanceOf(CommandHandlerNotFoundException);
    await expect(queryBus.execute(new GetUserQuery('u-1'))).rejects.toBeInstanceOf(QueryHandlerNotFoundException);
    await eventBus.publish(new UserCreatedEvent('alice'));

    expect(seen).toEqual([]);
    expect(loggerEvents.some((event) => event.includes('Command handlers are registered only for singleton providers'))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('Query handlers are registered only for singleton providers'))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('Event handlers are registered only for singleton providers'))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('Sagas are registered only for singleton providers'))).toBe(true);

    await app.close();
  });

  it('throws typed not-found exceptions for command/query types without handlers', async () => {
    class MissingCommand implements ICommand {
      constructor(public readonly id: string) {}
    }

    class MissingQuery implements IQuery<{ id: string }> {
      readonly __queryResultType__?: { id: string };

      constructor(public readonly id: string) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    await expect(commandBus.execute(new MissingCommand('cmd'))).rejects.toBeInstanceOf(CommandHandlerNotFoundException);
    await expect(queryBus.execute(new MissingQuery('qry'))).rejects.toBeInstanceOf(QueryHandlerNotFoundException);

    await app.close();
  });

  it('resolves class-first CQRS services and keeps token aliases functional', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBusByClass = await app.container.resolve(CommandBusLifecycleService);
    const commandBusByToken = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBusByClass = await app.container.resolve(QueryBusLifecycleService);
    const queryBusByToken = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBusByClass = await app.container.resolve(CqrsEventBusService);
    const eventBusByToken = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    expect(commandBusByClass).toBeInstanceOf(CommandBusLifecycleService);
    expect(queryBusByClass).toBeInstanceOf(QueryBusLifecycleService);
    expect(eventBusByClass).toBeInstanceOf(CqrsEventBusService);
    expect(typeof commandBusByToken.execute).toBe('function');
    expect(typeof queryBusByToken.execute).toBe('function');
    expect(typeof eventBusByToken.publish).toBe('function');
    expect(typeof eventBusByToken.publishAll).toBe('function');

    await app.close();
  });

  it('fails bootstrap when duplicate command handlers are registered for one command type', async () => {
    @CommandHandler(CreateUserCommand)
    class FirstCreateUserHandler {
      execute(_command: CreateUserCommand) {
        return 'first';
      }
    }

    @CommandHandler(CreateUserCommand)
    class SecondCreateUserHandler {
      execute(_command: CreateUserCommand) {
        return 'second';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [FirstCreateUserHandler, SecondCreateUserHandler],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toBeInstanceOf(DuplicateCommandHandlerError);
  });

  it('fails bootstrap when one command handler class is registered under different singleton tokens', async () => {
    const FIRST_CREATE_USER_HANDLER = Symbol('FIRST_CREATE_USER_HANDLER');
    const SECOND_CREATE_USER_HANDLER = Symbol('SECOND_CREATE_USER_HANDLER');

    @CommandHandler(CreateUserCommand)
    class SharedCreateUserHandler {
      execute(_command: CreateUserCommand) {
        return 'shared';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: FIRST_CREATE_USER_HANDLER, useClass: SharedCreateUserHandler },
        { provide: SECOND_CREATE_USER_HANDLER, useClass: SharedCreateUserHandler },
      ],
    });

    const error = await bootstrapApplication({ rootModule: AppModule }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DuplicateCommandHandlerError);
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Symbol(FIRST_CREATE_USER_HANDLER)') }));
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Symbol(SECOND_CREATE_USER_HANDLER)') }));
  });

  it('fails bootstrap when duplicate query handlers are registered for one query type', async () => {
    @QueryHandler(GetUserQuery)
    class FirstGetUserHandler {
      execute(_query: GetUserQuery) {
        return 'first';
      }
    }

    @QueryHandler(GetUserQuery)
    class SecondGetUserHandler {
      execute(_query: GetUserQuery) {
        return 'second';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [FirstGetUserHandler, SecondGetUserHandler],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toBeInstanceOf(DuplicateQueryHandlerError);
  });

  it('fails bootstrap when one query handler class is registered under different singleton tokens', async () => {
    const FIRST_GET_USER_HANDLER = Symbol('FIRST_GET_USER_HANDLER');
    const SECOND_GET_USER_HANDLER = Symbol('SECOND_GET_USER_HANDLER');

    @QueryHandler(GetUserQuery)
    class SharedGetUserHandler {
      execute(_query: GetUserQuery) {
        return 'shared';
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: FIRST_GET_USER_HANDLER, useClass: SharedGetUserHandler },
        { provide: SECOND_GET_USER_HANDLER, useClass: SharedGetUserHandler },
      ],
    });

    const error = await bootstrapApplication({ rootModule: AppModule }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DuplicateQueryHandlerError);
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Symbol(FIRST_GET_USER_HANDLER)') }));
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Symbol(SECOND_GET_USER_HANDLER)') }));
  });

  it('delegates publish and publishAll to the underlying event bus when no CQRS event handlers are registered', async () => {
    const publish = vi.fn(async () => undefined);
    const eventBus = { publish };
    const loggerEvents: string[] = [];
    const container = new Container();
    const sagaService = new CqrsSagaLifecycleService(container, [], createLogger(loggerEvents));
    const cqrsEventBus = new CqrsEventBusService(
      eventBus,
      sagaService,
      container,
      [],
      createLogger(loggerEvents),
    );

    const events = [new UserCreatedEvent('alice'), new UserCreatedEvent('bob')];

    await cqrsEventBus.publish(events[0]!);
    await cqrsEventBus.publishAll(events);

    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenNthCalledWith(1, events[0]);
    expect(publish).toHaveBeenNthCalledWith(2, events[0]);
    expect(publish).toHaveBeenNthCalledWith(3, events[1]);
  });

  it('keeps EVENT_BUS available as a compatibility CQRS event-bus token', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    expect(typeof eventBus.publish).toBe('function');
    expect(typeof eventBus.publishAll).toBe('function');

    await app.close();
  });

  it('keeps delegated event-bus providers module-local when CQRS global is false', async () => {
    @Inject(FLUO_EVENT_BUS)
    class SiblingEventBusConsumer {
      constructor(readonly eventBus: EventBus) {}
    }

    class CqrsHostModule {}
    defineModule(CqrsHostModule, {
      imports: [CqrsModule.forRoot({ global: false })],
    });

    class SiblingModule {}
    defineModule(SiblingModule, {
      providers: [SiblingEventBusConsumer],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsHostModule, SiblingModule],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow();
  });

  it('honors an explicit delegated event-bus global override when CQRS global is false', async () => {
    @Inject(FLUO_EVENT_BUS)
    class SiblingEventBusConsumer {
      constructor(readonly eventBus: EventBus) {}
    }

    class CqrsHostModule {}
    defineModule(CqrsHostModule, {
      imports: [CqrsModule.forRoot({ eventBus: { global: true }, global: false })],
    });

    class SiblingModule {}
    defineModule(SiblingModule, {
      providers: [SiblingEventBusConsumer],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsHostModule, SiblingModule],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const consumer = await app.container.resolve(SiblingEventBusConsumer);

    expect(typeof consumer.eventBus.publish).toBe('function');

    await app.close();
  });

  it('accepts CqrsModule.forRoot handler option arrays and registers those classes', async () => {
    @CommandHandler(CreateUserCommand)
    class OptionCreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      execute(command: CreateUserCommand): string {
        return `opt:${command.name}`;
      }
    }

    @QueryHandler(GetUserQuery)
    class OptionGetUserHandler implements IQueryHandler<GetUserQuery, { id: string; name: string | undefined }> {
      execute(query: GetUserQuery): { id: string; name: string | undefined } {
        return { id: query.id, name: 'option-user' };
      }
    }

    const receivedNames: string[] = [];

    @EventHandler(UserCreatedEvent)
    class OptionEventRecorder implements IEventHandler<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        receivedNames.push(event.name);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CqrsModule.forRoot({
          commandHandlers: [OptionCreateUserHandler],
          eventBus: { publish: { waitForHandlers: true } },
          eventHandlers: [OptionEventRecorder],
          queryHandlers: [OptionGetUserHandler],
        }),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    const commandResult = await commandBus.execute(new CreateUserCommand('alice'));
    const queryResult = await queryBus.execute(new GetUserQuery('u-1'));
    await eventBus.publish(new UserCreatedEvent('alice'));

    expect(commandResult).toBe('opt:alice');
    expect(queryResult).toEqual({ id: 'u-1', name: 'option-user' });
    expect(receivedNames).toEqual(['alice']);

    await app.close();
  });

  it('rejects command and query dispatch after shutdown starts and clears preloaded handler caches', async () => {
    class ShutdownCommand implements ICommand {
      constructor(public readonly id: string) {}
    }

    class ShutdownQuery implements IQuery<string> {
      readonly __queryResultType__?: string;

      constructor(public readonly id: string) {}
    }

    @CommandHandler(ShutdownCommand)
    class ShutdownCommandHandler implements ICommandHandler<ShutdownCommand, string> {
      execute(command: ShutdownCommand): string {
        return `command:${command.id}`;
      }
    }

    @QueryHandler(ShutdownQuery)
    class ShutdownQueryHandler implements IQueryHandler<ShutdownQuery, string> {
      execute(query: ShutdownQuery): string {
        return `query:${query.id}`;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownCommandHandler, ShutdownQueryHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const commandBusService = await app.container.resolve(CommandBusLifecycleService);
    const queryBusService = await app.container.resolve(QueryBusLifecycleService);

    expect(getPreloadedHandlerCount(commandBusService)).toBe(1);
    expect(getPreloadedHandlerCount(queryBusService)).toBe(1);

    expect(await commandBus.execute<ShutdownCommand, string>(new ShutdownCommand('active'))).toBe('command:active');
    expect(await queryBus.execute<ShutdownQuery, string>(new ShutdownQuery('active'))).toBe('query:active');

    await app.close();

    await expect(commandBus.execute(new ShutdownCommand('late'))).rejects.toBeInstanceOf(InvariantError);
    await expect(queryBus.execute(new ShutdownQuery('late'))).rejects.toBeInstanceOf(InvariantError);

    expect(getPreloadedHandlerCount(commandBusService)).toBe(0);
    expect(getPreloadedHandlerCount(queryBusService)).toBe(0);
  });

  it('rejects command and query dispatch as soon as application shutdown begins before their own shutdown hooks run', async () => {
    const shutdownStarted = createDeferred<void>();
    const releaseShutdown = createDeferred<void>();

    class ShutdownCommand implements ICommand {
      constructor(public readonly id: string) {}
    }

    class ShutdownQuery implements IQuery<string> {
      readonly __queryResultType__?: string;

      constructor(public readonly id: string) {}
    }

    @CommandHandler(ShutdownCommand)
    class ShutdownCommandHandler implements ICommandHandler<ShutdownCommand, string> {
      execute(command: ShutdownCommand): string {
        return `command:${command.id}`;
      }
    }

    @QueryHandler(ShutdownQuery)
    class ShutdownQueryHandler implements IQueryHandler<ShutdownQuery, string> {
      execute(query: ShutdownQuery): string {
        return `query:${query.id}`;
      }
    }

    class ShutdownBlocker implements OnApplicationShutdown {
      async onApplicationShutdown(): Promise<void> {
        shutdownStarted.resolve();
        await releaseShutdown.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownCommandHandler, ShutdownQueryHandler, ShutdownBlocker],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const commandBusService = await app.container.resolve(CommandBusLifecycleService);
    const queryBusService = await app.container.resolve(QueryBusLifecycleService);

    expect(getPreloadedHandlerCount(commandBusService)).toBe(1);
    expect(getPreloadedHandlerCount(queryBusService)).toBe(1);
    expect(await commandBus.execute<ShutdownCommand, string>(new ShutdownCommand('active'))).toBe('command:active');
    expect(await queryBus.execute<ShutdownQuery, string>(new ShutdownQuery('active'))).toBe('query:active');

    const closePromise = app.close();
    await shutdownStarted.promise;

    expect(getPreloadedHandlerCount(commandBusService)).toBe(1);
    expect(getPreloadedHandlerCount(queryBusService)).toBe(1);
    await expect(commandBus.execute(new ShutdownCommand('late'))).rejects.toBeInstanceOf(InvariantError);
    await expect(queryBus.execute(new ShutdownQuery('late'))).rejects.toBeInstanceOf(InvariantError);

    releaseShutdown.resolve();
    await closePromise;

    expect(getPreloadedHandlerCount(commandBusService)).toBe(0);
    expect(getPreloadedHandlerCount(queryBusService)).toBe(0);
  });

  it('rejects CQRS event publishes as soon as runtime shutdown-start cleanup runs', async () => {
    const cleanupCallbacks: Array<() => void> = [];
    const loggerEvents: string[] = [];
    const container = new Container();
    const registerRuntimeCleanup = createRuntimeCleanupRegistry(cleanupCallbacks);
    const sagaBus = new CqrsSagaLifecycleService(container, [], createLogger(loggerEvents), {}, registerRuntimeCleanup);
    const delegatedEventBus = { publish: vi.fn(async () => undefined) } satisfies EventBus;
    const cqrsEventBus = new CqrsEventBusService(
      delegatedEventBus,
      sagaBus,
      container,
      [],
      createLogger(loggerEvents),
      {},
      registerRuntimeCleanup,
    );

    await sagaBus.onApplicationBootstrap();
    await cqrsEventBus.onApplicationBootstrap();
    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }

    await expect(cqrsEventBus.publish(new UserCreatedEvent('late'))).rejects.toBeInstanceOf(InvariantError);
    expect(delegatedEventBus.publish).not.toHaveBeenCalled();
  });

  it('rejects direct saga dispatch as soon as runtime shutdown-start cleanup runs', async () => {
    const cleanupCallbacks: Array<() => void> = [];
    const loggerEvents: string[] = [];
    const container = new Container();
    const sagaBus = new CqrsSagaLifecycleService(
      container,
      [],
      createLogger(loggerEvents),
      {},
      createRuntimeCleanupRegistry(cleanupCallbacks),
    );

    await sagaBus.onApplicationBootstrap();
    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }

    await expect(sagaBus.dispatch(new UserCreatedEvent('late'))).rejects.toBeInstanceOf(InvariantError);
  });

  it('continues saga shutdown drain until late nested saga work is quiescent', async () => {
    const firstWorkRelease = createDeferred<void>();
    const secondWorkRelease = createDeferred<void>();
    const loggerEvents: string[] = [];
    const sagaBus = new CqrsSagaLifecycleService(
      new Container(),
      [],
      createLogger(loggerEvents),
      { shutdown: { drainTimeoutMs: 1000 } },
    );
    const pendingDispatches = getPendingSagaDispatches(sagaBus);
    let shutdownCompleted = false;
    let firstWork!: Promise<void>;
    let secondWork!: Promise<void>;

    secondWork = secondWorkRelease.promise.then(() => {
      pendingDispatches.delete(secondWork);
    });
    firstWork = firstWorkRelease.promise.then(() => {
      pendingDispatches.delete(firstWork);
      pendingDispatches.add(secondWork);
    });
    pendingDispatches.add(firstWork);

    const shutdownPromise = sagaBus.onApplicationShutdown().then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);

    firstWorkRelease.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);

    secondWorkRelease.resolve();
    await shutdownPromise;

    expect(shutdownCompleted).toBe(true);
    expect(sagaBus.getRuntimeSnapshot().shutdownDrainTimeouts).toBe(0);
    expect(loggerEvents).toEqual([]);
  });

  it('orchestrates follow-up commands across multiple events over time with sagas', async () => {
    class ProcessStore {
      commandLog: string[] = [];
      sagaLog: string[] = [];
    }

    class StartPaymentCommand implements ICommand {
      constructor(public readonly orderId: string) {}
    }

    class ReserveInventoryCommand implements ICommand {
      constructor(public readonly orderId: string) {}
    }

    class CompleteOrderCommand implements ICommand {
      constructor(public readonly orderId: string) {}
    }

    class OrderSubmittedEvent implements IEvent {
      constructor(public readonly orderId: string) {}
    }

    class PaymentAuthorizedEvent implements IEvent {
      constructor(public readonly orderId: string) {}
    }

    class InventoryReservedEvent implements IEvent {
      constructor(public readonly orderId: string) {}
    }

    @Inject(EVENT_BUS, ProcessStore)
    @CommandHandler(StartPaymentCommand)
    class StartPaymentHandler implements ICommandHandler<StartPaymentCommand> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ProcessStore,
      ) {}

      async execute(command: StartPaymentCommand, context?: CqrsDispatchContext): Promise<void> {
        this.store.commandLog.push(`start-payment:${command.orderId}`);
        await this.eventBus.publish(new PaymentAuthorizedEvent(command.orderId), context);
      }
    }

    @Inject(EVENT_BUS, ProcessStore)
    @CommandHandler(ReserveInventoryCommand)
    class ReserveInventoryHandler implements ICommandHandler<ReserveInventoryCommand> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ProcessStore,
      ) {}

      async execute(command: ReserveInventoryCommand, context?: CqrsDispatchContext): Promise<void> {
        this.store.commandLog.push(`reserve-inventory:${command.orderId}`);
        await this.eventBus.publish(new InventoryReservedEvent(command.orderId), context);
      }
    }

    @Inject(ProcessStore)
    @CommandHandler(CompleteOrderCommand)
    class CompleteOrderHandler implements ICommandHandler<CompleteOrderCommand> {
      constructor(private readonly store: ProcessStore) {}

      execute(command: CompleteOrderCommand): void {
        this.store.commandLog.push(`complete-order:${command.orderId}`);
      }
    }

    @Inject(COMMAND_BUS, ProcessStore)
    @Saga([OrderSubmittedEvent, PaymentAuthorizedEvent, InventoryReservedEvent])
    class OrderFulfillmentSaga implements ISaga<IEvent> {
      constructor(
        private readonly commandBus: CommandBus,
        private readonly store: ProcessStore,
      ) {}

      async handle(event: IEvent, context?: CqrsDispatchContext): Promise<void> {
        if (event instanceof OrderSubmittedEvent) {
          this.store.sagaLog.push(`submitted:${event.orderId}`);
          await this.commandBus.execute(new StartPaymentCommand(event.orderId), context);
          return;
        }

        if (event instanceof PaymentAuthorizedEvent) {
          this.store.sagaLog.push(`payment-authorized:${event.orderId}`);
          await this.commandBus.execute(new ReserveInventoryCommand(event.orderId), context);
          return;
        }

        if (event instanceof InventoryReservedEvent) {
          this.store.sagaLog.push(`inventory-reserved:${event.orderId}`);
          await this.commandBus.execute(new CompleteOrderCommand(event.orderId), context);
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        ProcessStore,
        StartPaymentHandler,
        ReserveInventoryHandler,
        CompleteOrderHandler,
        OrderFulfillmentSaga,
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(ProcessStore);

    await eventBus.publish(new OrderSubmittedEvent('order-1'));

    expect(store.sagaLog).toEqual([
      'submitted:order-1',
      'payment-authorized:order-1',
      'inventory-reserved:order-1',
    ]);
    expect(store.commandLog).toEqual([
      'start-payment:order-1',
      'reserve-inventory:order-1',
      'complete-order:order-1',
    ]);

    await app.close();
  });

  it('deduplicates saga registration when the same saga class is provided twice', async () => {
    let handledCount = 0;

    class AccountActivatedEvent implements IEvent {
      constructor(public readonly accountId: string) {}
    }

    @Saga(AccountActivatedEvent)
    class AccountActivationSaga implements ISaga<AccountActivatedEvent> {
      handle(_event: AccountActivatedEvent): void {
        handledCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CqrsModule.forRoot({
          sagas: [AccountActivationSaga],
        }),
      ],
      providers: [AccountActivationSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await eventBus.publish(new AccountActivatedEvent('acct-1'));

    expect(handledCount).toBe(1);

    await app.close();
  });

  it('ignores caller-shaped dispatch context internals and only trusts CQRS-created context', async () => {
    let handledCount = 0;

    class ExternalContextEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Saga(ExternalContextEvent)
    class ExternalContextSaga implements ISaga<ExternalContextEvent> {
      handle(_event: ExternalContextEvent): void {
        handledCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ExternalContextSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const callerShapedContext = {
      activeRoutes: [{ eventType: ExternalContextEvent, token: ExternalContextSaga }],
      depth: 32,
      path: ['caller-shaped-context'],
    };

    await eventBus.publish(new ExternalContextEvent('ctx-1'), callerShapedContext);

    expect(handledCount).toBe(1);

    await app.close();
  });

  it('wraps unexpected saga failures in SagaExecutionError', async () => {
    class PaymentFailedEvent implements IEvent {
      constructor(public readonly orderId: string) {}
    }

    @Saga(PaymentFailedEvent)
    class FailingSaga implements ISaga<PaymentFailedEvent> {
      handle(_event: PaymentFailedEvent): void {
        throw new Error('saga exploded');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [FailingSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(eventBus.publish(new PaymentFailedEvent('order-2'))).rejects.toBeInstanceOf(SagaExecutionError);
    await expect(eventBus.publish(new PaymentFailedEvent('order-2'))).rejects.toThrow('saga exploded');

    await app.close();
  });

  it('fails fast when a saga republishes an event that re-enters the same saga token', async () => {
    class LoopEvent implements IEvent {
      constructor(public readonly loopId: string) {}
    }

    @Inject(EVENT_BUS)
    @Saga(LoopEvent)
    class SelfTriggeringSaga implements ISaga<LoopEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(event: LoopEvent, context?: CqrsDispatchContext): Promise<void> {
        await this.eventBus.publish(new LoopEvent(event.loopId), context);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [SelfTriggeringSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(eventBus.publish(new LoopEvent('loop-1'))).rejects.toBeInstanceOf(SagaTopologyError);
    await expect(eventBus.publish(new LoopEvent('loop-1'))).rejects.toThrow('unsafe cycle');

    await app.close();
  });

  it('fails fast when saga graphs form a cyclic re-entrant topology', async () => {
    class StepOneEvent implements IEvent {
      constructor(public readonly workflowId: string) {}
    }

    class StepTwoEvent implements IEvent {
      constructor(public readonly workflowId: string) {}
    }

    @Inject(EVENT_BUS)
    @Saga(StepOneEvent)
    class StepOneSaga implements ISaga<StepOneEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(event: StepOneEvent, context?: CqrsDispatchContext): Promise<void> {
        await this.eventBus.publish(new StepTwoEvent(event.workflowId), context);
      }
    }

    @Inject(EVENT_BUS)
    @Saga(StepTwoEvent)
    class StepTwoSaga implements ISaga<StepTwoEvent> {
      constructor(private readonly eventBus: CqrsEventBus) {}

      async handle(event: StepTwoEvent, context?: CqrsDispatchContext): Promise<void> {
        await this.eventBus.publish(new StepOneEvent(event.workflowId), context);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [StepOneSaga, StepTwoSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(eventBus.publish(new StepOneEvent('wf-1'))).rejects.toBeInstanceOf(SagaTopologyError);
    await expect(eventBus.publish(new StepOneEvent('wf-1'))).rejects.toThrow(
      'StepOneSaga(StepOneEvent) -> StepTwoSaga(StepTwoEvent) -> StepOneSaga(StepOneEvent)',
    );

    await app.close();
  });

  it('fails fast when nested in-process saga dispatch exceeds the depth guard', async () => {
    const chainLength = 33;
    const eventTypes = Array.from({ length: chainLength }, (_, index) => {
      class DepthEvent implements IEvent {
        constructor(public readonly hop: number = index + 1) {}
      }

      return DepthEvent;
    });

    function createDepthSaga<TEvent extends IEvent>(
      EventType: new (...args: never[]) => TEvent,
      NextEventType: (new (...args: never[]) => IEvent) | undefined,
    ) {
      @Inject(EVENT_BUS)
      @Saga(EventType)
      class DepthSaga implements ISaga<TEvent> {
        constructor(private readonly eventBus: CqrsEventBus) {}

        async handle(_event: TEvent, context?: CqrsDispatchContext): Promise<void> {
          if (NextEventType) {
            await this.eventBus.publish(new NextEventType(), context);
          }
        }
      }

      return DepthSaga;
    }

    const sagaProviders = eventTypes.map((EventType, index) => createDepthSaga(EventType, eventTypes[index + 1]));

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: sagaProviders,
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(eventBus.publish(new eventTypes[0]!())).rejects.toBeInstanceOf(SagaTopologyError);
    await expect(eventBus.publish(new eventTypes[0]!())).rejects.toThrow('maximum nested saga depth of 32');

    await app.close();
  });

  it('does not publish to transport when a CQRS event handler fails', async () => {
    const transport = {
      published: [] as Array<{ channel: string; payload: unknown }>,
      async publish(channel: string, payload: unknown) {
        this.published.push({ channel, payload });
      },
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
      async close() {},
    } satisfies EventBusTransport & {
      published: Array<{ channel: string; payload: unknown }>;
    };

    @EventHandler(UserCreatedEvent)
    class FailingEventHandler implements IEventHandler<UserCreatedEvent> {
      handle(_event: UserCreatedEvent): void {
        throw new Error('handler exploded');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ eventBus: { transport } })],
      providers: [FailingEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await expect(eventBus.publish(new UserCreatedEvent('alice'))).rejects.toThrow('handler exploded');
    expect(transport.published).toEqual([]);

    await app.close();
  });

  it('dispatches a CQRS event to all matching @EventHandler classes', async () => {
    const seen: string[] = [];

    @EventHandler(UserCreatedEvent)
    class FirstEventHandler implements IEventHandler<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`first:${event.name}`);
      }
    }

    @EventHandler(UserCreatedEvent)
    class SecondEventHandler implements IEventHandler<UserCreatedEvent> {
      handle(event: UserCreatedEvent): void {
        seen.push(`second:${event.name}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [FirstEventHandler, SecondEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await eventBus.publish(new UserCreatedEvent('alice'));

    expect(seen).toEqual(['first:alice', 'second:alice']);

    await app.close();
  });

  it('matches inherited event instances for event handlers and sagas', async () => {
    const seen: string[] = [];

    class BaseAuditEvent implements IEvent {
      constructor(public readonly auditId: string) {}
    }

    class DetailedAuditEvent extends BaseAuditEvent {
      constructor(
        auditId: string,
        public readonly detail: string,
      ) {
        super(auditId);
      }
    }

    @EventHandler(BaseAuditEvent)
    class BaseAuditEventHandler implements IEventHandler<BaseAuditEvent> {
      handle(event: BaseAuditEvent): void {
        seen.push(`handler:${event.auditId}:${event instanceof BaseAuditEvent}`);
      }
    }

    @Saga(BaseAuditEvent)
    class BaseAuditSaga implements ISaga<BaseAuditEvent> {
      handle(event: BaseAuditEvent): void {
        seen.push(`saga:${event.auditId}:${event instanceof BaseAuditEvent}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [BaseAuditEventHandler, BaseAuditSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await eventBus.publish(new DetailedAuditEvent('audit-1', 'full-detail'));

    expect(seen).toEqual(['handler:audit-1:true', 'saga:audit-1:true']);

    await app.close();
  });

  it('isolates CQRS event handler and saga mutations from delegated event-bus subscribers', async () => {
    interface Snapshot {
      readonly flagged: boolean;
      readonly label: string;
      readonly tags: readonly string[];
    }

    class MutationStore {
      delegatedSnapshots: Snapshot[] = [];
      handlerSnapshots: Snapshot[] = [];
      sagaSnapshots: Snapshot[] = [];

      record(collection: Snapshot[], label: string, event: MutableProfileEvent): void {
        collection.push({
          flagged: event.payload.nested.flagged,
          label,
          tags: [...event.payload.tags],
        });
      }
    }

    class MutableProfileEvent implements IEvent {
      constructor(
        public readonly userId: string,
        public readonly payload: { nested: { flagged: boolean }; tags: string[] },
      ) {}
    }

    @Inject(MutationStore)
    @EventHandler(MutableProfileEvent)
    class MutatingEventHandler implements IEventHandler<MutableProfileEvent> {
      constructor(private readonly store: MutationStore) {}

      handle(event: MutableProfileEvent): void {
        event.payload.tags.push('handler-mutated');
        event.payload.nested.flagged = true;
        this.store.record(this.store.handlerSnapshots, 'mutating-handler', event);
      }
    }

    @Inject(MutationStore)
    @EventHandler(MutableProfileEvent)
    class ObservingEventHandler implements IEventHandler<MutableProfileEvent> {
      constructor(private readonly store: MutationStore) {}

      handle(event: MutableProfileEvent): void {
        this.store.record(this.store.handlerSnapshots, 'observing-handler', event);
      }
    }

    @Inject(MutationStore)
    @Saga(MutableProfileEvent)
    class MutatingSaga implements ISaga<MutableProfileEvent> {
      constructor(private readonly store: MutationStore) {}

      handle(event: MutableProfileEvent): void {
        event.payload.tags.push('saga-mutated');
        event.payload.nested.flagged = true;
        this.store.record(this.store.sagaSnapshots, 'mutating-saga', event);
      }
    }

    @Inject(MutationStore)
    class DelegatedEventBusProjection {
      constructor(private readonly store: MutationStore) {}

      @OnEvent(MutableProfileEvent)
      onMutableProfile(event: MutableProfileEvent): void {
        this.store.record(this.store.delegatedSnapshots, 'delegated-event-bus', event);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [MutationStore, MutatingEventHandler, ObservingEventHandler, MutatingSaga, DelegatedEventBusProjection],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(MutationStore);
    const event = new MutableProfileEvent('user-1', {
      nested: { flagged: false },
      tags: ['original'],
    });

    await eventBus.publish(event);

    expect(store.handlerSnapshots).toEqual([
      { flagged: true, label: 'mutating-handler', tags: ['original', 'handler-mutated'] },
      { flagged: false, label: 'observing-handler', tags: ['original'] },
    ]);
    expect(store.sagaSnapshots).toEqual([{ flagged: true, label: 'mutating-saga', tags: ['original', 'saga-mutated'] }]);
    expect(store.delegatedSnapshots).toEqual([{ flagged: false, label: 'delegated-event-bus', tags: ['original'] }]);
    expect(event.payload).toEqual({ nested: { flagged: false }, tags: ['original'] });

    await app.close();
  });

  it('processes saga events in a deterministic order under concurrent publish calls', async () => {
    class SequenceStore {
      seen: number[] = [];
    }

    class SequencedEvent implements IEvent {
      constructor(
        public readonly index: number,
        public readonly waitMs: number,
      ) {}
    }

    @Inject(SequenceStore)
    @Saga(SequencedEvent)
    class SequencingSaga implements ISaga<SequencedEvent> {
      constructor(private readonly store: SequenceStore) {}

      async handle(event: SequencedEvent): Promise<void> {
        await delay(event.waitMs);
        this.store.seen.push(event.index);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [SequenceStore, SequencingSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(SequenceStore);

    await Promise.all([
      eventBus.publish(new SequencedEvent(1, 30)),
      eventBus.publish(new SequencedEvent(2, 0)),
      eventBus.publish(new SequencedEvent(3, 0)),
    ]);

    expect(store.seen).toEqual([1, 2, 3]);

    await app.close();
  });

  it('waits for in-flight saga execution during application shutdown', async () => {
    const releaseSaga = createDeferred<void>();

    class ShutdownStore {
      completed = false;
    }

    class ShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Inject(ShutdownStore)
    @Saga(ShutdownEvent)
    class ShutdownSaga implements ISaga<ShutdownEvent> {
      constructor(private readonly store: ShutdownStore) {}

      async handle(_event: ShutdownEvent): Promise<void> {
        await releaseSaga.promise;
        this.store.completed = true;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownStore, ShutdownSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(ShutdownStore);

    const publishPromise = eventBus.publish(new ShutdownEvent('shutdown-1'));
    await Promise.resolve();

    const closePromise = app.close();
    await Promise.resolve();

    expect(store.completed).toBe(false);

    releaseSaga.resolve();

    await publishPromise;
    await closePromise;

    expect(store.completed).toBe(true);
  });

  it('bounds shutdown drain when saga execution is stuck', async () => {
    const loggerEvents: string[] = [];
    const releaseSaga = createDeferred<void>();
    const sagaStarted = createDeferred<void>();

    class ShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Saga(ShutdownEvent)
    class StuckShutdownSaga implements ISaga<ShutdownEvent> {
      async handle(_event: ShutdownEvent): Promise<void> {
        sagaStarted.resolve();
        await releaseSaga.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ shutdown: { drainTimeoutMs: 20 } })],
      providers: [StuckShutdownSaga],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const publishPromise = eventBus.publish(new ShutdownEvent('shutdown-stuck-saga'));

    await sagaStarted.promise;

    let closeCompleted = false;
    const closePromise = app.close().then(() => {
      closeCompleted = true;
    });

    await Promise.resolve();
    expect(closeCompleted).toBe(false);

    await closePromise;

    expect(closeCompleted).toBe(true);
    expect(loggerEvents.some((event) => event.includes('CQRS saga shutdown drain exceeded'))).toBe(true);

    releaseSaga.resolve();
    await publishPromise;
  });

  it('waits for in-flight CQRS event handlers during application shutdown', async () => {
    const releaseHandler = createDeferred<void>();
    let closeCompleted = false;

    class ShutdownStore {
      completed = false;
    }

    class HandlerShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Inject(ShutdownStore)
    @EventHandler(HandlerShutdownEvent)
    class ShutdownEventHandler implements IEventHandler<HandlerShutdownEvent> {
      constructor(private readonly store: ShutdownStore) {}

      async handle(_event: HandlerShutdownEvent): Promise<void> {
        await releaseHandler.promise;
        this.store.completed = true;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownStore, ShutdownEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(ShutdownStore);

    const publishPromise = eventBus.publish(new HandlerShutdownEvent('shutdown-handler-1'));
    await Promise.resolve();

    const closePromise = app.close().then(() => {
      closeCompleted = true;
    });
    await Promise.resolve();

    expect(closeCompleted).toBe(false);
    expect(store.completed).toBe(false);

    releaseHandler.resolve();

    await publishPromise;
    await closePromise;

    expect(store.completed).toBe(true);
  });

  it('bounds shutdown drain when a CQRS event handler is stuck', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];
    const releaseHandler = createDeferred<void>();

    class HandlerShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @EventHandler(HandlerShutdownEvent)
    class StuckShutdownEventHandler implements IEventHandler<HandlerShutdownEvent> {
      async handle(_event: HandlerShutdownEvent): Promise<void> {
        await releaseHandler.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ shutdown: { drainTimeoutMs: 20 } })],
      providers: [StuckShutdownEventHandler],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const publishPromise = eventBus.publish(new HandlerShutdownEvent('shutdown-stuck-handler'));

    await Promise.resolve();

    let closeCompleted = false;
    const closePromise = app.close().then(() => {
      closeCompleted = true;
    });

    await Promise.resolve();
    expect(closeCompleted).toBe(false);

    await vi.advanceTimersByTimeAsync(20);
    await closePromise;

    expect(closeCompleted).toBe(true);
    expect(loggerEvents.some((event) => event.includes('CQRS event shutdown drain exceeded 20ms'))).toBe(true);

    releaseHandler.resolve();
    await publishPromise;
    vi.useRealTimers();
  });

  it('waits for in-flight publishAll sequences during application shutdown', async () => {
    const releaseFirstEvent = createDeferred<void>();
    let closeCompleted = false;

    class BatchShutdownEvent implements IEvent {
      constructor(public readonly id: number) {}
    }

    class ShutdownStore {
      seen: number[] = [];
    }

    @Inject(ShutdownStore)
    @EventHandler(BatchShutdownEvent)
    class BatchShutdownEventHandler implements IEventHandler<BatchShutdownEvent> {
      constructor(private readonly store: ShutdownStore) {}

      async handle(event: BatchShutdownEvent): Promise<void> {
        if (event.id === 1) {
          await releaseFirstEvent.promise;
        }

        this.store.seen.push(event.id);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownStore, BatchShutdownEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(ShutdownStore);

    const publishAllPromise = eventBus.publishAll([new BatchShutdownEvent(1), new BatchShutdownEvent(2)]);
    await Promise.resolve();

    const closePromise = app.close().then(() => {
      closeCompleted = true;
    });
    await Promise.resolve();

    expect(closeCompleted).toBe(false);
    expect(store.seen).toEqual([]);

    releaseFirstEvent.resolve();

    await publishAllPromise;
    await closePromise;

    expect(store.seen).toEqual([1, 2]);
  });

  it('rejects new CQRS event publishes after shutdown starts while draining active work', async () => {
    const releaseHandler = createDeferred<void>();
    let capturedContext: CqrsDispatchContext | undefined;

    class GuardedShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class CapturedContextEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @EventHandler(CapturedContextEvent)
    class CapturedContextEventHandler implements IEventHandler<CapturedContextEvent> {
      handle(_event: CapturedContextEvent, context?: CqrsDispatchContext): void {
        capturedContext = context;
      }
    }

    @EventHandler(GuardedShutdownEvent)
    class GuardedShutdownEventHandler implements IEventHandler<GuardedShutdownEvent> {
      async handle(_event: GuardedShutdownEvent): Promise<void> {
        await releaseHandler.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [CapturedContextEventHandler, GuardedShutdownEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const eventBusService = await app.container.resolve(CqrsEventBusService);

    await eventBus.publish(new CapturedContextEvent('captured'));
    expect(capturedContext).toBeDefined();

    const publishPromise = eventBus.publish(new GuardedShutdownEvent('active'));

    await Promise.resolve();

    const closePromise = app.close();

    await vi.waitFor(() => {
      expect(eventBusService.createPlatformStatusSnapshot().details.lifecycleState).toBe('stopping');
    });

    await expect(eventBus.publish(new GuardedShutdownEvent('late'))).rejects.toBeInstanceOf(InvariantError);
    await expect(eventBus.publish(new GuardedShutdownEvent('stale-context'), capturedContext)).rejects.toBeInstanceOf(InvariantError);
    await expect(eventBus.publishAll([new GuardedShutdownEvent('late-batch')])).rejects.toBeInstanceOf(InvariantError);

    releaseHandler.resolve();

    await publishPromise;
    await closePromise;

    await expect(eventBus.publish(new GuardedShutdownEvent('stopped'))).rejects.toBeInstanceOf(InvariantError);
  });

  it('allows nested CQRS event publishes from an active handler context during shutdown drain', async () => {
    const handlerStarted = createDeferred<void>();
    const releaseNestedPublish = createDeferred<void>();

    class ParentShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class NestedShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class ShutdownStore {
      seen: string[] = [];
    }

    @Inject(EVENT_BUS, ShutdownStore)
    @EventHandler(ParentShutdownEvent)
    class ParentShutdownEventHandler implements IEventHandler<ParentShutdownEvent> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ShutdownStore,
      ) {}

      async handle(event: ParentShutdownEvent, context?: CqrsDispatchContext): Promise<void> {
        this.store.seen.push(`parent:start:${event.id}`);
        handlerStarted.resolve();
        await releaseNestedPublish.promise;
        await this.eventBus.publish(new NestedShutdownEvent(event.id), context);
        this.store.seen.push(`parent:end:${event.id}`);
      }
    }

    @Inject(ShutdownStore)
    @EventHandler(NestedShutdownEvent)
    class NestedShutdownEventHandler implements IEventHandler<NestedShutdownEvent> {
      constructor(private readonly store: ShutdownStore) {}

      handle(event: NestedShutdownEvent): void {
        this.store.seen.push(`nested:${event.id}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownStore, ParentShutdownEventHandler, NestedShutdownEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const eventBusService = await app.container.resolve(CqrsEventBusService);
    const store = await app.container.resolve(ShutdownStore);

    const publishPromise = eventBus.publish(new ParentShutdownEvent('parent'));
    await handlerStarted.promise;

    const closePromise = app.close();

    await vi.waitFor(() => {
      expect(eventBusService.createPlatformStatusSnapshot().details.lifecycleState).toBe('stopping');
    });

    releaseNestedPublish.resolve();

    await publishPromise;
    await closePromise;

    expect(store.seen).toEqual(['parent:start:parent', 'nested:parent', 'parent:end:parent']);
  });

  it('allows nested CQRS publishAll from an active saga context during shutdown drain', async () => {
    const sagaStarted = createDeferred<void>();
    const releaseNestedPublish = createDeferred<void>();

    class SagaParentShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class SagaNestedShutdownEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class ShutdownStore {
      seen: string[] = [];
    }

    @Inject(EVENT_BUS, ShutdownStore)
    @Saga(SagaParentShutdownEvent)
    class NestedPublishingSaga implements ISaga<SagaParentShutdownEvent> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ShutdownStore,
      ) {}

      async handle(event: SagaParentShutdownEvent, context?: CqrsDispatchContext): Promise<void> {
        this.store.seen.push(`saga:start:${event.id}`);
        sagaStarted.resolve();
        await releaseNestedPublish.promise;
        await this.eventBus.publishAll([
          new SagaNestedShutdownEvent(`${event.id}:first`),
          new SagaNestedShutdownEvent(`${event.id}:second`),
        ], context);
        this.store.seen.push(`saga:end:${event.id}`);
      }
    }

    @Inject(ShutdownStore)
    @EventHandler(SagaNestedShutdownEvent)
    class SagaNestedShutdownEventHandler implements IEventHandler<SagaNestedShutdownEvent> {
      constructor(private readonly store: ShutdownStore) {}

      handle(event: SagaNestedShutdownEvent): void {
        this.store.seen.push(`nested:${event.id}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ShutdownStore, NestedPublishingSaga, SagaNestedShutdownEventHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const eventBusService = await app.container.resolve(CqrsEventBusService);
    const store = await app.container.resolve(ShutdownStore);

    const publishPromise = eventBus.publish(new SagaParentShutdownEvent('parent'));
    await sagaStarted.promise;

    const closePromise = app.close();

    await vi.waitFor(() => {
      expect(eventBusService.createPlatformStatusSnapshot().details.lifecycleState).toBe('stopping');
    });

    releaseNestedPublish.resolve();

    await publishPromise;
    await closePromise;

    expect(store.seen).toEqual([
      'saga:start:parent',
      'nested:parent:first',
      'nested:parent:second',
      'saga:end:parent',
    ]);
  });

  it('rejects direct saga dispatch after shutdown starts', async () => {
    const releaseSaga = createDeferred<void>();

    class GuardedSagaEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    @Saga(GuardedSagaEvent)
    class GuardedSaga implements ISaga<GuardedSagaEvent> {
      async handle(_event: GuardedSagaEvent): Promise<void> {
        await releaseSaga.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [GuardedSaga],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const sagaBus = await app.container.resolve(CqrsSagaLifecycleService);
    const dispatchPromise = sagaBus.dispatch(new GuardedSagaEvent('active'));

    await Promise.resolve();

    const closePromise = app.close();

    await vi.waitFor(() => {
      expect(sagaBus.getRuntimeSnapshot().lifecycleState).toBe('stopping');
    });

    await expect(sagaBus.dispatch(new GuardedSagaEvent('late'))).rejects.toBeInstanceOf(InvariantError);

    releaseSaga.resolve();

    await dispatchPromise;
    await closePromise;

    await expect(sagaBus.dispatch(new GuardedSagaEvent('stopped'))).rejects.toBeInstanceOf(InvariantError);
  });

  it('does not wait for delegated event-bus subscribers when waitForHandlers is false', async () => {
    const releaseSubscriber = createDeferred<void>();
    const subscriberStarted = createDeferred<void>();
    const subscriberCompleted = createDeferred<void>();

    class DelegatedEvent implements IEvent {
      constructor(public readonly id: string) {}
    }

    class DelegatedSubscriber {
      @OnEvent(DelegatedEvent)
      async onDelegatedEvent(_event: DelegatedEvent): Promise<void> {
        subscriberStarted.resolve();
        await releaseSubscriber.promise;
        subscriberCompleted.resolve();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot({ eventBus: { publish: { waitForHandlers: false } } })],
      providers: [DelegatedSubscriber],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await eventBus.publish(new DelegatedEvent('delegated'));
    await subscriberStarted.promise;

    let subscriberFinished = false;
    subscriberCompleted.promise.then(() => {
      subscriberFinished = true;
    });
    await Promise.resolve();

    expect(subscriberFinished).toBe(false);

    releaseSubscriber.resolve();
    await subscriberCompleted.promise;
    expect(subscriberFinished).toBe(true);

    await app.close();
  });

  it('wires command/query/event buses through CqrsModule.forRoot with bootstrapApplication', async () => {
    class Store {
      commandCount = 0;
      eventNames: string[] = [];
    }

    @Inject(Store)
    @CommandHandler(CreateUserCommand)
    class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      constructor(private readonly store: Store) {}

      execute(command: CreateUserCommand): string {
        this.store.commandCount += 1;
        return command.name;
      }
    }

    @Inject(Store)
    @QueryHandler(GetUserCountQuery)
    class GetUserHandler implements IQueryHandler<GetUserCountQuery, number> {
      constructor(private readonly store: Store) {}

      execute(_query: GetUserCountQuery): number {
        return this.store.commandCount;
      }
    }

    @Inject(Store)
    @EventHandler(UserCreatedEvent)
    class UserCreatedEventRecorder implements IEventHandler<UserCreatedEvent> {
      constructor(private readonly store: Store) {}

      handle(event: UserCreatedEvent): void {
        this.store.eventNames.push(event.name);
      }
    }

    @Inject(Store)
    class UserCreatedOnEventProjection {
      constructor(private readonly store: Store) {}

      @OnEvent(UserCreatedEvent)
      onUserCreated(event: UserCreatedEvent): void {
        this.store.eventNames.push(`on:${event.name}`);
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [Store, CreateUserHandler, GetUserHandler, UserCreatedEventRecorder, UserCreatedOnEventProjection],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const store = await app.container.resolve(Store);

    await commandBus.execute(new CreateUserCommand('alice'));
    const commandCount = await queryBus.execute<GetUserCountQuery, number>(new GetUserCountQuery('ignored'));
    await eventBus.publish(new UserCreatedEvent('alice'));
    await eventBus.publishAll([new UserCreatedEvent('bob')]);

    expect(commandCount).toBe(1);
    expect(store.commandCount).toBe(1);
    expect(store.eventNames).toEqual(['alice', 'on:alice', 'bob', 'on:bob']);

    await app.close();
  });
});
