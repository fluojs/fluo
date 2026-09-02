import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CommandHandler, EventHandler, QueryHandler, Saga } from './decorators.js';
import { CqrsModule } from './module.js';
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

class ArchiveUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class CountUsersQuery implements IQuery<number> {
  readonly __queryResultType__?: number;
}

class UserArchivedEvent implements IEvent {
  constructor(public readonly name: string) {}
}

describe('CQRS provider-form discovery contracts', () => {
  it('discovers command and query handlers registered as singleton factory providers', async () => {
    @CommandHandler(ArchiveUserCommand)
    class ArchiveUserHandler implements ICommandHandler<ArchiveUserCommand, string> {
      execute(command: ArchiveUserCommand): string {
        return `factory-command:${command.name}`;
      }
    }

    @QueryHandler(CountUsersQuery)
    class CountUsersHandler implements IQueryHandler<CountUsersQuery, number> {
      execute(): number {
        return 7;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: ArchiveUserHandler, useFactory: () => new ArchiveUserHandler() },
        { provide: CountUsersHandler, useFactory: () => new CountUsersHandler() },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('alice'))).resolves.toBe(
      'factory-command:alice',
    );
    await expect(queryBus.execute<CountUsersQuery, number>(new CountUsersQuery())).resolves.toBe(7);

    await app.close();
  });

  it('discovers command and query handlers registered as singleton value providers', async () => {
    @CommandHandler(ArchiveUserCommand)
    class ArchiveUserHandler implements ICommandHandler<ArchiveUserCommand, string> {
      execute(command: ArchiveUserCommand): string {
        return `value-command:${command.name}`;
      }
    }

    @QueryHandler(CountUsersQuery)
    class CountUsersHandler implements IQueryHandler<CountUsersQuery, number> {
      execute(): number {
        return 11;
      }
    }

    const ARCHIVE_HANDLER_TOKEN = Symbol('ARCHIVE_HANDLER_TOKEN');
    const COUNT_HANDLER_TOKEN = Symbol('COUNT_HANDLER_TOKEN');

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: ARCHIVE_HANDLER_TOKEN, useValue: new ArchiveUserHandler() },
        { provide: COUNT_HANDLER_TOKEN, useValue: new CountUsersHandler() },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('bob'))).resolves.toBe(
      'value-command:bob',
    );
    await expect(queryBus.execute<CountUsersQuery, number>(new CountUsersQuery())).resolves.toBe(11);

    await app.close();
  });

  it('discovers event handlers and sagas registered as singleton factory and value providers', async () => {
    const seen: string[] = [];

    @EventHandler(UserArchivedEvent)
    class ArchiveEventHandler implements IEventHandler<UserArchivedEvent> {
      handle(event: UserArchivedEvent): void {
        seen.push(`factory-event:${event.name}`);
      }
    }

    @Saga(UserArchivedEvent)
    class ArchiveSaga implements ISaga<UserArchivedEvent> {
      handle(event: UserArchivedEvent): void {
        seen.push(`value-saga:${event.name}`);
      }
    }

    const SAGA_TOKEN = Symbol('SAGA_TOKEN');

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: ArchiveEventHandler, useFactory: () => new ArchiveEventHandler() },
        { provide: SAGA_TOKEN, useValue: new ArchiveSaga() },
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const eventBus = await app.container.resolve<CqrsEventBus>(EVENT_BUS);

    await eventBus.publish(new UserArchivedEvent('carol'));

    expect(seen).toEqual(['factory-event:carol', 'value-saga:carol']);

    await app.close();
  });

  it('resolves factory-provided handlers through their own factory instance', async () => {
    @CommandHandler(ArchiveUserCommand)
    class ArchiveUserHandler implements ICommandHandler<ArchiveUserCommand, string> {
      constructor(private readonly marker: string) {}

      execute(command: ArchiveUserCommand): string {
        return `${this.marker}:${command.name}`;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [{ provide: ArchiveUserHandler, useFactory: () => new ArchiveUserHandler('from-factory') }],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('dave'))).resolves.toBe(
      'from-factory:dave',
    );

    await app.close();
  });

});
