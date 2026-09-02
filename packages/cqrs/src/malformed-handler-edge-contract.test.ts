import { InvariantError } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CommandHandler, QueryHandler } from './decorators.js';
import { CqrsModule } from './module.js';
import { COMMAND_BUS, QUERY_BUS } from './tokens.js';
import type { CommandBus, ICommand, IQuery, QueryBus } from './types.js';

describe('CQRS malformed handler dispatch contracts', () => {
  it('rejects a command handler whose execute member is not callable', async () => {
    // Given
    class MalformedCommand implements ICommand {}

    @CommandHandler(MalformedCommand)
    class MalformedCommandHandler {
      readonly execute = 'not-a-function';
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [MalformedCommandHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const commandBus = await app.container.resolve<CommandBus>(COMMAND_BUS);

    try {
      // When
      const dispatch = commandBus.execute(new MalformedCommand());

      // Then
      await expect(dispatch).rejects.toBeInstanceOf(InvariantError);
      await expect(dispatch).rejects.toMatchObject({ code: 'INVARIANT_ERROR' });
    } finally {
      await app.close();
    }
  });

  it('rejects a query handler whose execute member is not callable', async () => {
    // Given
    class MalformedQuery implements IQuery<string> {
      readonly __queryResultType__?: string;
    }

    @QueryHandler(MalformedQuery)
    class MalformedQueryHandler {
      readonly execute = 42;
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CqrsModule.forRoot()],
      providers: [MalformedQueryHandler],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const queryBus = await app.container.resolve<QueryBus>(QUERY_BUS);

    try {
      // When
      const dispatch = queryBus.execute(new MalformedQuery());

      // Then
      await expect(dispatch).rejects.toBeInstanceOf(InvariantError);
      await expect(dispatch).rejects.toMatchObject({ code: 'INVARIANT_ERROR' });
    } finally {
      await app.close();
    }
  });
});
