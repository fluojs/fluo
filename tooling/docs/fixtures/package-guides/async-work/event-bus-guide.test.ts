import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { RedisEventBusTransport } from '@fluojs/event-bus/redis';
import {
  EventBusService,
  type EventPublishResult,
  type EventPublishSettlement,
} from '@fluojs/event-bus';
import { FluoFactory } from '@fluojs/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRedisFixture } from '../../../../testing/redis-native-fixture.mjs';
import {
  createEventBusGuideApp,
  DomainEvent,
  OrderPlacedEvent,
  SlowEvent,
  UnheardEvent,
  UserSignedUpEvent,
} from './event-bus-guide-app';
import { boundedWait } from './helpers';

/**
 * Native guide fixture for the Event bus guide
 * (apps/docs/content/docs/packages/event-bus.mdx).
 *
 * Evidence scope: in-process publication, the EventPublishResult contract,
 * instanceof inheritance matching, per-call timeout bounds, background
 * completion, post-shutdown rejection, and - against a real redis:7.4-alpine
 * server (repository fixture harness, isolated container, ephemeral loopback
 * port) - RedisEventBusTransport channel lineage and inbound delivery.
 * Requires Docker; consistent with the repository's native suites, it fails
 * rather than skips when the fixture is unavailable.
 */

/** Runtime-narrowing guards for the EventPublishResult union. */
function assertSettled(result: EventPublishResult): Extract<EventPublishResult, { status: 'settled' }> {
  if (result.status !== 'settled') {
    throw new Error(`Expected a settled publication, received ${result.status}.`);
  }

  return result;
}

function assertNoRecipients(
  result: EventPublishResult,
): Extract<EventPublishResult, { status: 'no-recipients' }> {
  if (result.status !== 'no-recipients') {
    throw new Error(`Expected a no-recipients publication, received ${result.status}.`);
  }

  return result;
}

function assertBackground(result: EventPublishResult): Extract<EventPublishResult, { status: 'background' }> {
  if (result.status !== 'background') {
    throw new Error(`Expected a background publication, received ${result.status}.`);
  }

  return result;
}

function assertSettledSettlement(
  settlement: EventPublishSettlement,
): Extract<EventPublishSettlement, { status: 'settled' }> {
  if (settlement.status !== 'settled') {
    throw new Error(`Expected a settled settlement, received ${settlement.status}.`);
  }

  return settlement;
}

describe('event bus guide fixtures: publication results and matching', () => {
  it('delivers cloned payloads to matching handlers and reports settled outcomes', async () => {
    const { AppModule, EventProbe: Probe } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const probe = await context.get(Probe);

      const original = new OrderPlacedEvent('order-1');
      const result = assertSettled(await boundedWait(events.publish(original), 'settled publish'));

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toMatchObject({
        status: 'succeeded',
        target: { kind: 'handler', targetName: 'GuideHandlers', methodName: 'projectDomainEvent' },
      });

      await boundedWait(probe.waitDeliveries(1), 'handler delivery');
      const delivered = probe.delivered[0] as OrderPlacedEvent;

      // Each handler receives an isolated clone restored to the MATCHED
      // event type's prototype; the published subclass state carries over.
      expect(delivered).not.toBe(original);
      expect(delivered).toBeInstanceOf(DomainEvent);
      expect(delivered.orderId).toBe('order-1');
    } finally {
      await context.close();
    }
  });

  it('returns no-recipients for an event with no handler and no transport', async () => {
    const { AppModule } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const result = assertNoRecipients(await events.publish(new UnheardEvent()));

      expect(result.outcomes).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('observes a timed-out outcome without killing the underlying handler work', async () => {
    const { AppModule, EventProbe: Probe } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const probe = await context.get(Probe);

      probe.hold();
      const result = assertSettled(
        await boundedWait(events.publish(new SlowEvent('bounded'), { timeoutMs: 50 }), 'timed-out publish'),
      );

      expect(result.outcomes[0]).toMatchObject({
        status: 'timed-out',
        timeoutMs: 50,
        target: { kind: 'handler', methodName: 'handleSlowEvent' },
      });

      // The caller-facing wait settled, but the started handler continues and
      // completes once the gate opens - shutdown drain tracks this work.
      probe.release();
      await boundedWait(probe.waitDeliveries(1), 'handler completion after timeout');
      expect((probe.delivered[0] as SlowEvent).payload).toBe('bounded');
    } finally {
      await context.close();
    }
  });

  it('schedules background work with waitForHandlers: false and reports completion', async () => {
    const { AppModule, EventProbe: Probe } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const probe = await context.get(Probe);

      const result = assertBackground(
        await events.publish(new UserSignedUpEvent('bg@fluo.dev'), { waitForHandlers: false }),
      );
      const settlement = assertSettledSettlement(await boundedWait(result.completion, 'background completion'));

      expect(settlement.outcomes[0]?.status).toBe('succeeded');
      await boundedWait(probe.waitDeliveries(1), 'background handler delivery');
      expect((probe.delivered[0] as UserSignedUpEvent).email).toBe('bg@fluo.dev');
    } finally {
      await context.close();
    }
  });

  it('rejects publication with reason stopped after the context closed', async () => {
    const { AppModule } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);
    const events = await context.get(EventBusService);

    await context.close();

    const result = await events.publish(new UserSignedUpEvent('late@fluo.dev'));

    expect(result).toEqual({ status: 'rejected', reason: 'stopped' });
  });

  it('keeps the static eventKey handler out of unrelated publications', async () => {
    const { AppModule, EventProbe: Probe } = createEventBusGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const probe = await context.get(Probe);

      await boundedWait(events.publish(new UserSignedUpEvent('dev@fluo.dev')), 'signed-up publish');

      expect(probe.delivered).toHaveLength(1);
      expect(probe.delivered[0]).toBeInstanceOf(UserSignedUpEvent);
      expect(probe.delivered[0]).not.toBeInstanceOf(DomainEvent);
    } finally {
      await context.close();
    }
  });
});

describe('event bus guide fixtures: native Redis Pub/Sub transport', () => {
  const containerName = `fluo-docs-guides-async-work-${randomUUID()}`;
  const exec = promisify(execFile);
  let fixture: Awaited<ReturnType<typeof startRedisFixture>> | undefined;

  beforeAll(async () => {
    fixture = await startRedisFixture({
      containerName,
      diagnosticPath: resolve('.artifacts/redis-native-fixture/docs-package-guides-async-work.json'),
      execFile: exec,
      spawn,
    });
  }, 70_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('fans a subclass publication out to its lineage channels and dispatches the inbound copy', async () => {
    // The Redis transport subpath exports live behind the optional ioredis
    // peer, which the root workspace does not re-export; resolve the real
    // client constructor through the owning package's dependency tree.
    const requireFromRedisPackage = createRequire(resolve(process.cwd(), 'packages/redis/package.json'));
    type TransportOptions = ConstructorParameters<typeof RedisEventBusTransport>[0];
    const RedisClientCtor = requireFromRedisPackage('ioredis') as new (options: {
      host: string;
      port: number;
    }) => TransportOptions['publishClient'];

    const redisOptions = { host: '127.0.0.1', port: fixture!.port };
    const publishClient = new RedisClientCtor(redisOptions);
    const subscribeClient = new RedisClientCtor(redisOptions);
    const { AppModule, EventProbe: Probe } = createEventBusGuideApp({
      transport: new RedisEventBusTransport({ publishClient, subscribeClient }),
    });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const events = await context.get(EventBusService);
      const probe = await context.get(Probe);

      const result = assertSettled(await boundedWait(events.publish(new OrderPlacedEvent('order-redis')), 'transport publish'));

      const transportOutcomes = result.outcomes.filter((outcome) => outcome.target.kind === 'transport');
      const channels = transportOutcomes.map((outcome) =>
        outcome.target.kind === 'transport' ? outcome.target.channel : '',
      );

      // Channel lineage: the concrete class channel plus the base class channel.
      expect(channels).toContain('OrderPlacedEvent');
      expect(channels).toContain('DomainEvent');
      expect(transportOutcomes.every((outcome) => outcome.status === 'succeeded')).toBe(true);

      // One local delivery during publish plus one inbound delivery on the
      // subscribed base-class channel, each with a rehydrated prototype.
      await boundedWait(probe.waitDeliveries(2), 'local + inbound delivery');

      for (const delivered of probe.delivered as OrderPlacedEvent[]) {
        expect(delivered).toBeInstanceOf(DomainEvent);
        expect(delivered.orderId).toBe('order-redis');
      }
    } finally {
      await context.close();
      await publishClient.quit();
      await subscribeClient.quit();
    }
  }, 30_000);
});
