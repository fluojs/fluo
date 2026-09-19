import { Inject, Scope } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { EventPattern } from './decorators.js';
import { MicroservicesModule } from './module.js';
import { KafkaMicroserviceTransport } from './transports/kafka-transport.js';
import { RabbitMqMicroserviceTransport } from './transports/rabbitmq-transport.js';
import {
  type RedisStreamClientLike,
  RedisStreamsMicroserviceTransport,
  type RedisStreamWriteOptions,
} from './transports/redis-streams-transport.js';

class MockRedisStreamBus implements RedisStreamClientLike {
  readonly ackedIds: string[] = [];
  private readonly ackWaiters = new Map<string, ReturnType<typeof createDeferred<void>>>();
  private readonly entries = new Map<string, Array<{ id: string; fields: Record<string, string> }>>();

  deliver(stream: string, id: string, fields: Record<string, string>): void {
    const entries = this.entries.get(stream) ?? [];
    entries.push({ id, fields });
    this.entries.set(stream, entries);
  }

  waitForAcknowledgement(id: string): Promise<void> {
    const waiter = createDeferred<void>();
    this.ackWaiters.set(id, waiter);
    return waiter.promise;
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    void stream;
    void group;
    this.ackedIds.push(id);
    this.ackWaiters.get(id)?.resolve();
  }

  async xreadgroup(
    _group: string,
    _consumer: string,
    streams: readonly string[],
    _options?: { blockMs?: number; count?: number },
  ): Promise<readonly { id: string; fields: Record<string, string> }[] | null> {
    const stream = streams[0];
    const entries = this.entries.get(stream);

    if (!entries || entries.length === 0) {
      return null;
    }

    return entries.splice(0);
  }

  async xadd(stream: string, _fields: Record<string, string>, _options?: RedisStreamWriteOptions): Promise<string> {
    void stream;
    return '0-1';
  }

  async xgroupCreate(_stream: string, _group: string, _id: string, _mkstream?: boolean): Promise<void> {
    return;
  }

  async xgroupDestroy(_stream: string, _group: string): Promise<void> {
    return;
  }

  async xgroup(_command: 'CREATE', _stream: string, _group: string, _id: string, _options?: { mkstream?: boolean }): Promise<void> {
    return;
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}.`));
        }, 1_000);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

describe('Durable event pattern error propagation integration', () => {
  it('prevents Redis Streams from acknowledging when decorated @EventPattern handler fails', async () => {
    const bus = new MockRedisStreamBus();
    const handlerFailed = createDeferred<void>();

    const transport = new RedisStreamsMicroserviceTransport({
      consumerGroup: 'test-group',
      namespace: 'test-streams',
      pollBlockMs: 10,
      readerClient: bus,
      writerClient: bus,
    });

    class FailingEventHandler {
      @EventPattern('audit.fail')
      onAudit() {
        handlerFailed.resolve();
        throw new Error('redis streams handler explosion');
      }

      @EventPattern('audit.ok')
      onSuccess() {
        return 'success';
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [FailingEventHandler],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule);
    await microservice.listen();

    const eventStream = 'test-streams:events';
    const failureId = '0-1';
    const successId = '0-2';
    const successAcknowledged = bus.waitForAcknowledgement(successId);

    bus.deliver(eventStream, failureId, {
      kind: 'event',
      pattern: 'audit.fail',
      payload: JSON.stringify({ value: 2 }),
    });
    bus.deliver(eventStream, successId, {
      kind: 'event',
      pattern: 'audit.ok',
      payload: JSON.stringify({ value: 1 }),
    });

    await within(handlerFailed.promise, 'failing Redis Streams handler delivery');
    await within(successAcknowledged, 'successful Redis Streams acknowledgement');
    expect(bus.ackedIds).toContain(successId);
    expect(bus.ackedIds).not.toContain(failureId);

    await microservice.close();
  });

  it('rejects Kafka consumer callback when decorated @EventPattern handler fails', async () => {
    const topicHandlers = new Map<string, (message: string) => Promise<void> | void>();
    const handlerEntered = createDeferred<void>();
    const releaseHandler = createDeferred<void>();
    const handlerError = new Error('kafka processing failed');

    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic, handler) => {
          topicHandlers.set(topic, handler);
        },
        unsubscribe: async () => undefined,
      },
      eventTopic: 'test.kafka.events',
      producer: {
        publish: async () => undefined,
      },
    });

    class KafkaEventHandler {
      @EventPattern('kafka.order.created')
      async onOrderCreated(payload: { orderId: string }) {
        void payload;
        handlerEntered.resolve();
        await releaseHandler.promise;
        throw handlerError;
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [KafkaEventHandler],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule);
    await microservice.listen();

    const consumerHandler = topicHandlers.get('test.kafka.events');
    expect(consumerHandler).toBeDefined();

    const rawMessage = JSON.stringify({
      kind: 'event',
      pattern: 'kafka.order.created',
      payload: { orderId: '123' },
    });

    const delivery = consumerHandler!(rawMessage);
    await within(handlerEntered.promise, 'Kafka event handler delivery');
    releaseHandler.resolve();
    await expect(delivery).rejects.toBe(handlerError);

    await microservice.close();
  });

  it('rejects RabbitMQ consumer callback when decorated @EventPattern handler fails', async () => {
    let consumerHandler: ((message: string) => Promise<void> | void) | undefined;
    const handlerEntered = createDeferred<void>();
    const releaseHandler = createDeferred<void>();
    const handlerError = new Error('rabbit payment processing failed');

    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        cancel: async () => undefined,
        consume: async (_queue, handler) => {
          consumerHandler = handler;
        },
      },
      eventQueue: 'test.rabbit.events',
      publisher: {
        publish: async () => undefined,
      },
    });

    class RabbitEventHandler {
      @EventPattern('rabbit.payment.received')
      async onPayment(payload: { amount: number }) {
        void payload;
        handlerEntered.resolve();
        await releaseHandler.promise;
        throw handlerError;
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [RabbitEventHandler],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule);
    await microservice.listen();

    expect(consumerHandler).toBeDefined();

    const rawMessage = JSON.stringify({
      kind: 'event',
      pattern: 'rabbit.payment.received',
      payload: { amount: 100 },
    });

    const delivery = consumerHandler!(rawMessage);
    await within(handlerEntered.promise, 'RabbitMQ event handler delivery');
    releaseHandler.resolve();
    await expect(delivery).rejects.toBe(handlerError);

    await microservice.close();
  });

  it('disposes request-scoped @EventPattern handlers while propagating failure to the transport', async () => {
    const disposedIds: number[] = [];
    const topicHandlers = new Map<string, (message: string) => Promise<void> | void>();
    const disposalEntered = createDeferred<void>();
    const disposalReleased = createDeferred<void>();
    const disposalFinished = createDeferred<void>();
    const handlerEntered = createDeferred<void>();
    const handlerError = new Error('scoped event failure');

    @Scope('request')
    class RequestContext {
      static count = 0;
      readonly id = ++RequestContext.count;

      async onDestroy(): Promise<void> {
        disposalEntered.resolve();
        await disposalReleased.promise;
        disposedIds.push(this.id);
        disposalFinished.resolve();
      }
    }

    @Inject(RequestContext)
    @Scope('request')
    class ScopedEventHandler {
      constructor(private readonly ctx: RequestContext) {}

      @EventPattern('scoped.durable.event')
      onEvent() {
        void this.ctx;
        handlerEntered.resolve();
        throw handlerError;
      }
    }

    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic, handler) => {
          topicHandlers.set(topic, handler);
        },
        unsubscribe: async () => undefined,
      },
      eventTopic: 'test.scoped.events',
      producer: {
        publish: async () => undefined,
      },
    });

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [MicroservicesModule.forRoot({ transport })],
      providers: [RequestContext, ScopedEventHandler],
    });

    const microservice = await FluoFactory.createMicroservice(AppModule);
    await microservice.listen();

    const consumerHandler = topicHandlers.get('test.scoped.events');
    expect(consumerHandler).toBeDefined();

    const rawMessage = JSON.stringify({
      kind: 'event',
      pattern: 'scoped.durable.event',
      payload: { test: true },
    });

    const delivery = consumerHandler!(rawMessage);
    await within(handlerEntered.promise, 'request-scoped event handler delivery');
    await within(disposalEntered.promise, 'request scope disposal start');
    disposalReleased.resolve();
    await within(disposalFinished.promise, 'request scope disposal completion');
    await expect(delivery).rejects.toBe(handlerError);

    expect(disposedIds).toEqual([1]);

    await microservice.close();
  });
});
