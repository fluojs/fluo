import { describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { Container } from '@konekti/di';
import { OnEvent } from '@konekti/event-bus';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

import { CommandHandler, EventHandler, QueryHandler } from './decorators.js';
import {
  CommandHandlerNotFoundException,
  DuplicateCommandHandlerError,
  DuplicateQueryHandlerError,
  QueryHandlerNotFoundException,
} from './errors.js';
import { CqrsEventBusService } from './event-bus.js';
import { getCommandHandlerMetadata, getEventHandlerMetadata, getQueryHandlerMetadata } from './metadata.js';
import { createCqrsModule } from './module.js';
import { CQRS_EVENT_BUS, COMMAND_BUS, EVENT_BUS, QUERY_BUS } from './tokens.js';
import type {
  CommandBus,
  CqrsEventBus,
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
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
  it('stores and reads class decorator metadata for command/query/event handlers', () => {
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

    class UndecoratedHandler {}

    expect(getCommandHandlerMetadata(CreateUserHandler)).toEqual({ commandType: CreateUserCommand });
    expect(getQueryHandlerMetadata(GetUserHandler)).toEqual({ queryType: GetUserQuery });
    expect(getEventHandlerMetadata(UserCreatedHandler)).toEqual({ eventType: UserCreatedEvent });
    expect(getCommandHandlerMetadata(UndecoratedHandler)).toBeUndefined();
    expect(getQueryHandlerMetadata(UndecoratedHandler)).toBeUndefined();
    expect(getEventHandlerMetadata(UndecoratedHandler)).toBeUndefined();
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
      imports: [createCqrsModule()],
      providers: [Store, CreateUserHandler, GetUserHandler],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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
      imports: [createCqrsModule()],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    await expect(commandBus.execute(new MissingCommand('cmd'))).rejects.toBeInstanceOf(CommandHandlerNotFoundException);
    await expect(queryBus.execute(new MissingQuery('qry'))).rejects.toBeInstanceOf(QueryHandlerNotFoundException);

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
      imports: [createCqrsModule()],
      providers: [FirstCreateUserHandler, SecondCreateUserHandler],
    });

    await expect(bootstrapApplication({ mode: 'test', rootModule: AppModule })).rejects.toBeInstanceOf(DuplicateCommandHandlerError);
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
      imports: [createCqrsModule()],
      providers: [FirstGetUserHandler, SecondGetUserHandler],
    });

    await expect(bootstrapApplication({ mode: 'test', rootModule: AppModule })).rejects.toBeInstanceOf(DuplicateQueryHandlerError);
  });

  it('delegates publish and publishAll to the underlying event bus when no CQRS event handlers are registered', async () => {
    const publish = vi.fn(async () => undefined);
    const eventBus = { publish };
    const loggerEvents: string[] = [];
    const cqrsEventBus = new CqrsEventBusService(
      eventBus,
      new Container(),
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

  it('exposes EVENT_BUS as a CQRS-compatible alias token', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [createCqrsModule()],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const busByAlias = await app.container.resolve<CqrsEventBus>(EVENT_BUS);
    const busByLegacy = await app.container.resolve<CqrsEventBus>(CQRS_EVENT_BUS);

    expect(busByAlias).toBe(busByLegacy);

    await app.close();
  });

  it('accepts createCqrsModule handler option arrays and registers those classes', async () => {
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
        createCqrsModule({
          commandHandlers: [OptionCreateUserHandler],
          eventBus: { publish: { waitForHandlers: true } },
          eventHandlers: [OptionEventRecorder],
          queryHandlers: [OptionGetUserHandler],
        }),
      ],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
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

  it('wires command/query/event buses through createCqrsModule with bootstrapApplication', async () => {
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
      imports: [createCqrsModule()],
      providers: [Store, CreateUserHandler, GetUserHandler, UserCreatedEventRecorder, UserCreatedOnEventProjection],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);
    const eventBus = await app.container.resolve<CqrsEventBus>(CQRS_EVENT_BUS);
    const store = await app.container.resolve(Store);

    await commandBus.execute(new CreateUserCommand('alice'));
    const commandCount = await queryBus.execute<GetUserCountQuery, number>(new GetUserCountQuery('ignored'));
    await eventBus.publish(new UserCreatedEvent('alice'));
    await eventBus.publishAll([new UserCreatedEvent('bob')]);

    expect(commandCount).toBe(1);
    expect(store.commandCount).toBe(1);
    expect(store.eventNames).toEqual(['on:alice', 'alice', 'on:bob', 'bob']);

    await app.close();
  });
});
