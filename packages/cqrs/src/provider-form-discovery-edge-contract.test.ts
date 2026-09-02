import { Scope } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { type ApplicationLogger, bootstrapApplication, type CompiledModule, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CommandHandler, QueryHandler } from './decorators.js';
import { CqrsBusBase, type DiscoveryCandidate } from './discovery.js';
import { CqrsModule } from './module.js';
import { COMMAND_BUS, QUERY_BUS } from './tokens.js';
import type { CommandBus, ICommand, ICommandHandler, IQuery, IQueryHandler, QueryBus } from './types.js';

function createLogger(events: string[]): ApplicationLogger {
  return {
    debug() {},
    error() {},
    log() {},
    warn(message: string, context?: string) {
      events.push(`warn:${context ?? 'none'}:${message}`);
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

    expect(discoveryBus.discover()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetType: ArchiveUserHandler,
          token: ArchiveUserHandler,
        }),
      ]),
    );
    expect(invoked).toEqual([]);
  });

  it('inherits resolverClass scope metadata to skip and block non-singleton factory handlers', async () => {
    const loggerEvents: string[] = [];
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
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    expect(
      loggerEvents.some(
        (entry) =>
          entry.includes('TransientArchiveHandler') &&
          entry.includes('@CommandHandler()') &&
          entry.includes('transient scope'),
      ),
    ).toBe(true);
    expect(
      loggerEvents.some(
        (entry) =>
          entry.includes('RequestCountHandler') && entry.includes('@QueryHandler()') && entry.includes('request scope'),
      ),
    ).toBe(true);
    expect(factoryCalls).toEqual([]);

    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    await expect(commandBus.execute<ArchiveUserCommand, string>(new ArchiveUserCommand('dave'))).rejects.toThrow(
      'No command handler registered for ArchiveUserCommand.',
    );
    await expect(queryBus.execute<CountUsersQuery, number>(new CountUsersQuery())).rejects.toThrow(
      'No query handler registered for CountUsersQuery.',
    );
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
