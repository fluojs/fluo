import { Scope } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { type ApplicationLogger, bootstrapApplication, type CompiledModule, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CommandHandler, QueryHandler } from './decorators.js';
import { CqrsBusBase, type DiscoveryCandidate } from './discovery.js';
import { CommandHandlerNotFoundException, QueryHandlerNotFoundException } from './errors.js';
import { CqrsModule } from './module.js';
import { COMMAND_BUS, QUERY_BUS } from './tokens.js';
import type { CommandBus, ICommand, ICommandHandler, IQuery, IQueryHandler, QueryBus } from './types.js';

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
  discover(): readonly DiscoveryCandidate[] {
    return this.discoveryCandidates();
  }
}

class ArchiveUserCommand implements ICommand {
  constructor(public readonly name: string) {}
}

class CountUsersQuery implements IQuery<number> {
  readonly __queryResultType__?: number;
}

describe('CQRS provider-form discovery edge contracts', () => {
  it('does not invoke unrelated factory providers during handler discovery', () => {
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
    const discoveryBus = new DiscoveryBus(new Container(), [compiledModule], createLogger([]));

    expect(discoveryBus.discover()).toEqual([
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

    const app = await bootstrapApplication({
      logger: createLogger(warnings),
      rootModule: AppModule,
    });

    expect(warnings).toEqual([
      { context: 'CommandBusLifecycleService' },
      { context: 'QueryBusLifecycleService' },
    ]);
    expect(factoryCalls).toEqual([]);

    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

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

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('frank'))).resolves.toBe(
      'alias-command:frank',
    );

    await app.close();
  });
});
