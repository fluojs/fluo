import { Scope } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { type ApplicationLogger, FluoFactory, type CompiledModule, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CommandHandler, EventHandler, QueryHandler, Saga } from './decorators.js';
import { CommandBusLifecycleService } from './buses/command-bus.js';
import { CqrsEventBusService } from './buses/event-bus.js';
import { CqrsSagaLifecycleService } from './buses/saga-bus.js';
import { CqrsBusBase, type DiscoveryCandidate } from './discovery.js';
import { CommandHandlerNotFoundException, QueryHandlerNotFoundException } from './errors.js';
import { CqrsModule } from './module.js';
import { QueryBusLifecycleService } from './buses/query-bus.js';
import type {
  CommandBus,
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  ISaga,
  QueryBus,
} from './types.js';

interface WarningEvent {
  readonly context: string | undefined;
}

function createLogger(warnings: WarningEvent[]): ApplicationLogger {
  return {
    debug() {},
    error() {},
    log() {},
    warn(_message: string, context?: string) {
      warnings.push({ context });
    },
  };
}

class DiscoveryBus extends CqrsBusBase {
  async discover(): Promise<readonly DiscoveryCandidate[]> {
    return await this.discoveryCandidates();
  }
}

class ArchiveUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class CountUsersQuery implements IQuery<number> {
  readonly __queryResultType__?: number;
}

describe('CQRS provider-form discovery edge contracts', () => {
  it('does not invoke unrelated factory providers during handler discovery', async () => {
    const invoked: string[] = [];

    @CommandHandler(ArchiveUserCommand)
    class ArchiveUserHandler implements ICommandHandler<ArchiveUserCommand, string> {
      execute(command: ArchiveUserCommand): string {
        return `factory-command:${command.name}`;
      }
    }

    const UNRELATED_TOKEN = Symbol('UNRELATED_TOKEN');
    const EAGER_VALUE_TOKEN = Symbol('EAGER_VALUE_TOKEN');

    class AppModule {}
    const compiledModule: CompiledModule = {
      accessibleTokens: new Set(),
      definition: {
        providers: [
          { provide: ArchiveUserHandler, useFactory: () => new ArchiveUserHandler() },
          {
            provide: UNRELATED_TOKEN,
            useFactory: () => {
              invoked.push('unrelated-factory');
              return { value: 'unrelated' };
            },
          },
          { provide: EAGER_VALUE_TOKEN, useValue: { value: 'plain-object' } },
        ],
      },
      exportedTokens: new Set(),
      importedExportedTokens: new Set(),
      providerTokens: new Set(),
      type: AppModule,
    };
    const container = new Container();
    container.register(...(compiledModule.definition.providers ?? []));
    const discoveryBus = new DiscoveryBus(container, [compiledModule], createLogger([]));

    expect(await discoveryBus.discover()).toEqual([
      {
        moduleName: AppModule.name,
        scope: 'singleton',
        targetType: ArchiveUserHandler,
        token: ArchiveUserHandler,
      },
    ]);
    expect(invoked).toEqual([]);
  });

  it('inherits resolverClass scope metadata to skip and block non-singleton factory handlers', async () => {
    const warnings: WarningEvent[] = [];
    const factoryCalls: string[] = [];

    @Scope('transient')
    @CommandHandler(ArchiveUserCommand)
    class TransientArchiveHandler implements ICommandHandler<ArchiveUserCommand, string> {
      execute(command: ArchiveUserCommand): string {
        return `transient-command:${command.name}`;
      }
    }

    @Scope('request')
    @QueryHandler(CountUsersQuery)
    class RequestCountHandler implements IQueryHandler<CountUsersQuery, number> {
      execute(): number {
        return 3;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        {
          provide: TransientArchiveHandler,
          resolverClass: TransientArchiveHandler,
          useFactory: () => {
            factoryCalls.push('transient-command');
            return new TransientArchiveHandler();
          },
        },
        {
          provide: RequestCountHandler,
          resolverClass: RequestCountHandler,
          useFactory: () => {
            factoryCalls.push('request-query');
            return new RequestCountHandler();
          },
        },
      ],
    });

    const app = await FluoFactory.create(AppModule, {
      logger: createLogger(warnings),
    });

    expect(warnings).toEqual([
      { context: 'CommandBusLifecycleService' },
      { context: 'QueryBusLifecycleService' },
    ]);
    expect(factoryCalls).toEqual([]);

    const commandBus = await app.container.resolve(CommandBusLifecycleService);
    const queryBus = await app.container.resolve(QueryBusLifecycleService);

    const [commandError, queryError] = await Promise.all([
      commandBus
        .execute<ArchiveUserCommand, string>(new ArchiveUserCommand('dave'))
        .then(() => undefined, (error: unknown) => error),
      queryBus.execute<CountUsersQuery, number>(new CountUsersQuery()).then(() => undefined, (error: unknown) => error),
    ]);

    expect(commandError).toBeInstanceOf(CommandHandlerNotFoundException);
    expect(commandError).toMatchObject({ code: 'CQRS_COMMAND_HANDLER_NOT_FOUND' });
    expect(queryError).toBeInstanceOf(QueryHandlerNotFoundException);
    expect(queryError).toMatchObject({ code: 'CQRS_QUERY_HANDLER_NOT_FOUND' });
    expect(factoryCalls).toEqual([]);

    await app.close();
  });

  it('keeps existing-provider aliases out of handler discovery', async () => {
    @CommandHandler(ArchiveUserCommand)
    class ArchiveUserHandler implements ICommandHandler<ArchiveUserCommand, string> {
      execute(command: ArchiveUserCommand): string {
        return `alias-command:${command.name}`;
      }
    }

    const ALIAS_TOKEN = Symbol('ALIAS_TOKEN');

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [ArchiveUserHandler, { provide: ALIAS_TOKEN, useExisting: ArchiveUserHandler }],
    });

    const app = await FluoFactory.create(AppModule);
    const commandBus = await app.container.resolve(CommandBusLifecycleService);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('frank'))).resolves.toBe(
      'alias-command:frank',
    );

    await app.close();
  });

  it('resolves duplicate provider tokens under warning policy to the winning provider without binding superseded handler classes', async () => {
    const SHARED_COMMAND_TOKEN = Symbol('SHARED_COMMAND_TOKEN');
    const SHARED_QUERY_TOKEN = Symbol('SHARED_QUERY_TOKEN');
    const SHARED_EVENT_TOKEN = Symbol('SHARED_EVENT_TOKEN');
    const SHARED_SAGA_TOKEN = Symbol('SHARED_SAGA_TOKEN');

    class FirstCommand implements ICommand {}
    class SecondCommand implements ICommand {}

    @CommandHandler(FirstCommand)
    class FirstCommandHandler implements ICommandHandler<FirstCommand, string> {
      execute(): string {
        return 'first-command';
      }
    }

    @CommandHandler(SecondCommand)
    class SecondCommandHandler implements ICommandHandler<SecondCommand, string> {
      execute(): string {
        return 'second-command';
      }
    }

    class FirstQuery implements IQuery<string> {
      readonly __queryResultType__?: string;
    }
    class SecondQuery implements IQuery<string> {
      readonly __queryResultType__?: string;
    }

    @QueryHandler(FirstQuery)
    class FirstQueryHandler implements IQueryHandler<FirstQuery, string> {
      execute(): string {
        return 'first-query';
      }
    }

    @QueryHandler(SecondQuery)
    class SecondQueryHandler implements IQueryHandler<SecondQuery, string> {
      execute(): string {
        return 'second-query';
      }
    }

    class FirstEvent implements IEvent {}
    class SecondEvent implements IEvent {}

    let firstEventHandled = 0;
    let secondEventHandled = 0;

    @EventHandler(FirstEvent)
    class FirstEventHandler implements IEventHandler<FirstEvent> {
      handle(): void {
        firstEventHandled += 1;
      }
    }

    @EventHandler(SecondEvent)
    class SecondEventHandler implements IEventHandler<SecondEvent> {
      handle(): void {
        secondEventHandled += 1;
      }
    }

    let firstSagaHandled = 0;
    let secondSagaHandled = 0;

    @Saga(FirstEvent)
    class FirstSaga implements ISaga<FirstEvent> {
      handle(): void {
        firstSagaHandled += 1;
      }
    }

    @Saga(SecondEvent)
    class SecondSaga implements ISaga<SecondEvent> {
      handle(): void {
        secondSagaHandled += 1;
      }
    }

    class ModuleA {}
    defineModule(ModuleA, {
      providers: [
        { provide: SHARED_COMMAND_TOKEN, useClass: FirstCommandHandler },
        { provide: SHARED_QUERY_TOKEN, useClass: FirstQueryHandler },
        { provide: SHARED_EVENT_TOKEN, useClass: FirstEventHandler },
        { provide: SHARED_SAGA_TOKEN, useClass: FirstSaga },
      ],
    });

    class ModuleB {}
    defineModule(ModuleB, {
      providers: [
        { provide: SHARED_COMMAND_TOKEN, useClass: SecondCommandHandler },
        { provide: SHARED_QUERY_TOKEN, useClass: SecondQueryHandler },
        { provide: SHARED_EVENT_TOKEN, useClass: SecondEventHandler },
        { provide: SHARED_SAGA_TOKEN, useClass: SecondSaga },
      ],
    });

    class RootModule {}
    defineModule(RootModule, {
      imports: [CqrsModule.forRoot(), ModuleA, ModuleB],
    });

    const app = await FluoFactory.create(RootModule, {
      duplicateProviderPolicy: 'warn',
    });

    const commandBus = await app.container.resolve(CommandBusLifecycleService);
    const queryBus = await app.container.resolve(QueryBusLifecycleService);
    const eventBus = await app.container.resolve(CqrsEventBusService);
    const sagaBus = await app.container.resolve(CqrsSagaLifecycleService);

    // 1. Command: winning provider executes; superseded handler is rejected as not found (not bound to winning instance)
    await expect(commandBus.execute(new SecondCommand())).resolves.toBe('second-command');
    await expect(commandBus.execute(new FirstCommand())).rejects.toBeInstanceOf(CommandHandlerNotFoundException);

    // 2. Query: winning provider executes; superseded handler is rejected as not found
    await expect(queryBus.execute(new SecondQuery())).resolves.toBe('second-query');
    await expect(queryBus.execute(new FirstQuery())).rejects.toBeInstanceOf(QueryHandlerNotFoundException);

    // 3. Event: winning provider handles event; superseded handler never invoked
    await eventBus.publish(new SecondEvent());
    expect(secondEventHandled).toBe(1);
    expect(secondSagaHandled).toBe(1);

    await eventBus.publish(new FirstEvent());
    expect(firstEventHandled).toBe(0);
    expect(firstSagaHandled).toBe(0);

    // 4. Snapshots: only winning handlers are counted
    const snapshot = eventBus.createPlatformStatusSnapshot();
    expect(snapshot.details.commandHandlersDiscovered).toBe(1);
    expect(snapshot.details.queryHandlersDiscovered).toBe(1);
    expect(snapshot.details.eventHandlersDiscovered).toBe(1);
    expect(snapshot.details.sagasDiscovered).toBe(1);

    await app.close();
  });

  it('uses runtime bootstrap overrides as the effective command, query, event, and saga providers', async () => {
    const COMMAND_HANDLER = Symbol('COMMAND_HANDLER');
    const QUERY_HANDLER = Symbol('QUERY_HANDLER');
    const EVENT_HANDLER = Symbol('EVENT_HANDLER');
    const SAGA_HANDLER = Symbol('SAGA_HANDLER');

    class ModuleCommand implements ICommand {}
    class RuntimeCommand implements ICommand {}

    @CommandHandler(ModuleCommand)
    class ModuleCommandHandler implements ICommandHandler<ModuleCommand, string> {
      execute(): string {
        return 'module-command';
      }
    }

    @CommandHandler(RuntimeCommand)
    class RuntimeCommandHandler implements ICommandHandler<RuntimeCommand, string> {
      execute(): string {
        return 'runtime-command';
      }
    }

    class ModuleQuery implements IQuery<string> {
      readonly __queryResultType__?: string;
    }
    class RuntimeQuery implements IQuery<string> {
      readonly __queryResultType__?: string;
    }

    @QueryHandler(ModuleQuery)
    class ModuleQueryHandler implements IQueryHandler<ModuleQuery, string> {
      execute(): string {
        return 'module-query';
      }
    }

    @QueryHandler(RuntimeQuery)
    class RuntimeQueryHandler implements IQueryHandler<RuntimeQuery, string> {
      execute(): string {
        return 'runtime-query';
      }
    }

    class ModuleEvent implements IEvent {}
    class RuntimeEvent implements IEvent {}

    let moduleEventCalls = 0;
    let runtimeEventCalls = 0;
    let moduleSagaCalls = 0;
    let runtimeSagaCalls = 0;

    @EventHandler(ModuleEvent)
    class ModuleEventHandler implements IEventHandler<ModuleEvent> {
      handle(): void {
        moduleEventCalls += 1;
      }
    }

    @EventHandler(RuntimeEvent)
    class RuntimeEventHandler implements IEventHandler<RuntimeEvent> {
      handle(): void {
        runtimeEventCalls += 1;
      }
    }

    @Saga(ModuleEvent)
    class ModuleSaga implements ISaga<ModuleEvent> {
      handle(): void {
        moduleSagaCalls += 1;
      }
    }

    @Saga(RuntimeEvent)
    class RuntimeSaga implements ISaga<RuntimeEvent> {
      handle(): void {
        runtimeSagaCalls += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [
        { provide: COMMAND_HANDLER, useClass: ModuleCommandHandler },
        { provide: QUERY_HANDLER, useClass: ModuleQueryHandler },
        { provide: EVENT_HANDLER, useClass: ModuleEventHandler },
        { provide: SAGA_HANDLER, useClass: ModuleSaga },
      ],
    });

    const app = await FluoFactory.create(AppModule, {
      providers: [
        { provide: COMMAND_HANDLER, useClass: RuntimeCommandHandler },
        { provide: QUERY_HANDLER, useClass: RuntimeQueryHandler },
        { provide: EVENT_HANDLER, useClass: RuntimeEventHandler },
        { provide: SAGA_HANDLER, useClass: RuntimeSaga },
      ],
    });
    const commandBus = await app.container.resolve(CommandBusLifecycleService);
    const queryBus = await app.container.resolve(QueryBusLifecycleService);
    const eventBus = await app.container.resolve(CqrsEventBusService);

    await expect(commandBus.execute(new RuntimeCommand())).resolves.toBe('runtime-command');
    await expect(commandBus.execute(new ModuleCommand())).rejects.toBeInstanceOf(CommandHandlerNotFoundException);
    await expect(queryBus.execute(new RuntimeQuery())).resolves.toBe('runtime-query');
    await expect(queryBus.execute(new ModuleQuery())).rejects.toBeInstanceOf(QueryHandlerNotFoundException);

    await eventBus.publish(new ModuleEvent());
    await eventBus.publish(new RuntimeEvent());

    expect(moduleEventCalls).toBe(0);
    expect(runtimeEventCalls).toBe(1);
    expect(moduleSagaCalls).toBe(0);
    expect(runtimeSagaCalls).toBe(1);

    const snapshot = eventBus.createPlatformStatusSnapshot();
    expect(snapshot.details.commandHandlersDiscovered).toBe(1);
    expect(snapshot.details.queryHandlersDiscovered).toBe(1);
    expect(snapshot.details.eventHandlersDiscovered).toBe(1);
    expect(snapshot.details.sagasDiscovered).toBe(1);

    await app.close();
  });
});
