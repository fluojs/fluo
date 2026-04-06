import { describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { Container } from '@konekti/di';
import { OnEvent, type EventBusTransport } from '@konekti/event-bus';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

import { CommandHandler, EventHandler, QueryHandler, Saga } from './decorators.js';
import { CommandBusLifecycleService } from './buses/command-bus.js';
import {
  CommandHandlerNotFoundException,
  DuplicateCommandHandlerError,
  DuplicateQueryHandlerError,
  QueryHandlerNotFoundException,
  SagaExecutionError,
} from './errors.js';
import { CqrsEventBusService } from './buses/event-bus.js';
import { getCommandHandlerMetadata, getEventHandlerMetadata, getQueryHandlerMetadata, getSagaMetadata } from './metadata.js';
import { CqrsModule } from './module.js';
import { QueryBusLifecycleService } from './buses/query-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { COMMAND_BUS, EVENT_BUS, QUERY_BUS } from './tokens.js';
import type {
  CommandBus,
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

describe('@konekti/cqrs', () => {
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

    @Inject([Store])
    @CommandHandler(CreateUserCommand)
    class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      constructor(private readonly store: Store) {}

      execute(command: CreateUserCommand): string {
        this.store.users.set('1', command.name);
        return `created:${command.name}`;
      }
    }

    @Inject([Store])
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

    @Inject([EVENT_BUS, ProcessStore])
    @CommandHandler(StartPaymentCommand)
    class StartPaymentHandler implements ICommandHandler<StartPaymentCommand> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ProcessStore,
      ) {}

      async execute(command: StartPaymentCommand): Promise<void> {
        this.store.commandLog.push(`start-payment:${command.orderId}`);
        await this.eventBus.publish(new PaymentAuthorizedEvent(command.orderId));
      }
    }

    @Inject([EVENT_BUS, ProcessStore])
    @CommandHandler(ReserveInventoryCommand)
    class ReserveInventoryHandler implements ICommandHandler<ReserveInventoryCommand> {
      constructor(
        private readonly eventBus: CqrsEventBus,
        private readonly store: ProcessStore,
      ) {}

      async execute(command: ReserveInventoryCommand): Promise<void> {
        this.store.commandLog.push(`reserve-inventory:${command.orderId}`);
        await this.eventBus.publish(new InventoryReservedEvent(command.orderId));
      }
    }

    @Inject([ProcessStore])
    @CommandHandler(CompleteOrderCommand)
    class CompleteOrderHandler implements ICommandHandler<CompleteOrderCommand> {
      constructor(private readonly store: ProcessStore) {}

      execute(command: CompleteOrderCommand): void {
        this.store.commandLog.push(`complete-order:${command.orderId}`);
      }
    }

    @Inject([COMMAND_BUS, ProcessStore])
    @Saga([OrderSubmittedEvent, PaymentAuthorizedEvent, InventoryReservedEvent])
    class OrderFulfillmentSaga implements ISaga<IEvent> {
      constructor(
        private readonly commandBus: CommandBus,
        private readonly store: ProcessStore,
      ) {}

      async handle(event: IEvent): Promise<void> {
        if (event instanceof OrderSubmittedEvent) {
          this.store.sagaLog.push(`submitted:${event.orderId}`);
          await this.commandBus.execute(new StartPaymentCommand(event.orderId));
          return;
        }

        if (event instanceof PaymentAuthorizedEvent) {
          this.store.sagaLog.push(`payment-authorized:${event.orderId}`);
          await this.commandBus.execute(new ReserveInventoryCommand(event.orderId));
          return;
        }

        if (event instanceof InventoryReservedEvent) {
          this.store.sagaLog.push(`inventory-reserved:${event.orderId}`);
          await this.commandBus.execute(new CompleteOrderCommand(event.orderId));
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

    @Inject([SequenceStore])
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

    @Inject([ShutdownStore])
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

  it('wires command/query/event buses through CqrsModule.forRoot with bootstrapApplication', async () => {
    class Store {
      commandCount = 0;
      eventNames: string[] = [];
    }

    @Inject([Store])
    @CommandHandler(CreateUserCommand)
    class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
      constructor(private readonly store: Store) {}

      execute(command: CreateUserCommand): string {
        this.store.commandCount += 1;
        return command.name;
      }
    }

    @Inject([Store])
    @QueryHandler(GetUserCountQuery)
    class GetUserHandler implements IQueryHandler<GetUserCountQuery, number> {
      constructor(private readonly store: Store) {}

      execute(_query: GetUserCountQuery): number {
        return this.store.commandCount;
      }
    }

    @Inject([Store])
    @EventHandler(UserCreatedEvent)
    class UserCreatedEventRecorder implements IEventHandler<UserCreatedEvent> {
      constructor(private readonly store: Store) {}

      handle(event: UserCreatedEvent): void {
        this.store.eventNames.push(event.name);
      }
    }

    @Inject([Store])
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
