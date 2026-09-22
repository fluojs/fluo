import {
  CommandBusLifecycleService,
  CommandHandlerNotFoundException,
  CqrsEventBusService,
  DuplicateCommandHandlerError,
  QueryBusLifecycleService,
} from '@fluojs/cqrs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  createCqrsGuideApp,
  createDuplicateCommandHandlerApp,
  CreateUserCommand,
  GetUserQuery,
  OrderPlacedEvent,
  UnknownCommand,
} from './cqrs-guide-app';

/**
 * Guide fixture for the CQRS guide (apps/docs/content/docs/packages/cqrs.mdx).
 *
 * Evidence scope: command/query dispatch with typed results, the documented
 * CQRS event pipeline order (event handlers -> sagas -> delegated
 * @fluojs/event-bus publication), per-handler clone isolation versus the
 * original payload passed to delegated subscribers, saga context
 * pass-through, missing-handler and duplicate-handler errors, and the status
 * snapshot contract. All waits are event-driven; publish() and execute()
 * are awaited directly.
 */

describe('cqrs guide fixtures: commands and queries', () => {
  it('dispatches a command to its discovered handler and returns the result', async () => {
    const { AppModule, CqrsTimeline: Timeline } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const commandBus = await context.get(CommandBusLifecycleService);
      const timeline = await context.get(Timeline);

      const result = await commandBus.execute(new CreateUserCommand('fluo'));

      expect(result).toBe('user-fluo');
      expect(timeline.entries).toEqual(['command:create-user']);
      expect(timeline.createdUsers).toEqual(['fluo']);
    } finally {
      await context.close();
    }
  });

  it('dispatches a typed query and returns the declared result type', async () => {
    const { AppModule } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const queryBus = await context.get(QueryBusLifecycleService);
      const view = await queryBus.execute(new GetUserQuery('u1'));

      expect(view).toEqual({ id: 'u1', name: 'fluo' });
      await expect(queryBus.execute(new GetUserQuery('missing'))).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it('rejects a command without a registered handler', async () => {
    const { AppModule } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const commandBus = await context.get(CommandBusLifecycleService);

      await expect(commandBus.execute(new UnknownCommand())).rejects.toBeInstanceOf(
        CommandHandlerNotFoundException,
      );
    } finally {
      await context.close();
    }
  });

  it('fails bootstrap when two different providers claim one command type', async () => {
    const { AppModule } = createDuplicateCommandHandlerApp();

    await expect(FluoFactory.createApplicationContext(AppModule)).rejects.toBeInstanceOf(
      DuplicateCommandHandlerError,
    );
  });
});

describe('cqrs guide fixtures: event pipeline and sagas', () => {
  it('runs event handlers, sagas, then delegated subscribers in the documented order', async () => {
    const { AppModule, CqrsTimeline: Timeline } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(CqrsEventBusService);
      const timeline = await context.get(Timeline);

      const original = new OrderPlacedEvent('order-9', 'customer-1');
      await events.publish(original);

      // Fixed pipeline: matching @EventHandler providers first, matching
      // @Saga providers second, then the delegated event-bus publication.
      // The saga's nested command executes inside the saga step, passing the
      // CqrsDispatchContext through unchanged.
      expect(timeline.entries).toEqual([
        'event-handler:order-9',
        'saga:order-9',
        'command:welcome-email:order-9',
        'delegated:order-9',
      ]);

      // CQRS handlers and sagas receive isolated copies; the delegated
      // event-bus publication carries the caller-owned payload, so each
      // @OnEvent subscriber observes those values on its own bus-level copy
      // - never a CQRS handler's mutated clone.
      expect(timeline.projectionCopies).toHaveLength(1);
      expect(timeline.projectionCopies[0]).not.toBe(original);
      expect(timeline.delegatedPayloads[0]).toStrictEqual(original);
      expect(timeline.delegatedPayloads[0]).not.toBe(timeline.projectionCopies[0]);
    } finally {
      await context.close();
    }
  });

  it('publishes event batches in input order through publishAll', async () => {
    const { AppModule, CqrsTimeline: Timeline } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(CqrsEventBusService);
      const timeline = await context.get(Timeline);

      await events.publishAll([new OrderPlacedEvent('a', 'c'), new OrderPlacedEvent('b', 'c')]);

      expect(timeline.entries.filter((entry) => entry.startsWith('delegated:'))).toEqual([
        'delegated:a',
        'delegated:b',
      ]);
    } finally {
      await context.close();
    }
  });

  it('reports ready discovery and lifecycle state in the status snapshot', async () => {
    const { AppModule } = createCqrsGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(CqrsEventBusService);
      const snapshot = events.createPlatformStatusSnapshot();

      expect(snapshot.readiness.status).toBe('ready');
      expect(snapshot.ownership).toMatchObject({ externallyManaged: false, ownsResources: false });
      expect(snapshot.details.dependencies).toEqual(['event-bus.default']);
      expect(snapshot.details.commandHandlersDiscovered).toBe(2);
      expect(snapshot.details.eventHandlersDiscovered).toBe(1);
      expect(snapshot.details.sagasDiscovered).toBe(1);
    } finally {
      await context.close();
    }
  });
});
