import { Inject, Scope } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

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
  private counter = 0;

  async xack(stream: string, group: string, id: string): Promise<void> {
    void stream;
    void group;
    this.ackedIds.push(id);
  }

  async xreadgroup(
    _group: string,
    _consumer: string,
    _streams: readonly string[],
    _options?: { blockMs?: number; count?: number },
  ): Promise<readonly { id: string; fields: Record<string, string> }[] | null> {
    return null;
  }

  async xadd(stream: string, _fields: Record<string, string>, _options?: RedisStreamWriteOptions): Promise<string> {
    void stream;
    this.counter += 1;
    return `0-${String(this.counter)}`;
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

describe('Durable event pattern error propagation integration', () => {
  it('prevents Redis Streams from acknowledging when decorated @EventPattern handler fails', async () => {
    const bus = new MockRedisStreamBus();
    const xackSpy = vi.spyOn(bus, 'xack');

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

    // Access the internal handleStreamEntry on the transport by sending stream entries
    const handleEntry = (transport as unknown as {
      handleStreamEntry(stream: string, message: unknown): Promise<boolean>;
      eventStream: string;
    });

    const eventStream = handleEntry.eventStream;

    // 1. Success event should return true (resulting in xack)
    const successResult = await handleEntry.handleStreamEntry(eventStream, {
      kind: 'event',
      pattern: 'audit.ok',
      payload: { value: 1 },
    });
    expect(successResult).toBe(true);

    // 2. Failing event must return false so xack is withheld
    const failureResult = await handleEntry.handleStreamEntry(eventStream, {
      kind: 'event',
      pattern: 'audit.fail',
      payload: { value: 2 },
    });
    expect(failureResult).toBe(false);

    // Verify xack was not called for the failure
    expect(xackSpy).not.toHaveBeenCalled();

    await microservice.close();
  });

  it('rejects Kafka consumer callback when decorated @EventPattern handler fails', async () => {
    const topicHandlers = new Map<string, (message: string) => Promise<void> | void>();

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
      onOrderCreated(payload: { orderId: string }) {
        void payload;
        throw new Error('kafka processing failed');
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

    // Kafka consumer callback must reject when handler fails so kafka adapter can withhold commit/retry
    await expect(consumerHandler!(rawMessage)).rejects.toThrow('kafka processing failed');

    await microservice.close();
  });

  it('rejects RabbitMQ consumer callback when decorated @EventPattern handler fails', async () => {
    let consumerHandler: ((message: string) => Promise<void> | void) | undefined;

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
      onPayment(payload: { amount: number }) {
        void payload;
        throw new Error('rabbit payment processing failed');
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

    // RabbitMQ consumer callback must reject so broker nacks / requeues
    await expect(consumerHandler!(rawMessage)).rejects.toThrow('rabbit payment processing failed');

    await microservice.close();
  });

  it('disposes request-scoped @EventPattern handlers while propagating failure to the transport', async () => {
    const disposedIds: number[] = [];
    const topicHandlers = new Map<string, (message: string) => Promise<void> | void>();

    @Scope('request')
    class RequestContext {
      static count = 0;
      readonly id = ++RequestContext.count;

      onDestroy(): void {
        disposedIds.push(this.id);
      }
    }

    @Inject(RequestContext)
    @Scope('request')
    class ScopedEventHandler {
      constructor(private readonly ctx: RequestContext) {}

      @EventPattern('scoped.durable.event')
      onEvent() {
        void this.ctx;
        throw new Error('scoped event failure');
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

    // Transport callback rejects
    await expect(consumerHandler!(rawMessage)).rejects.toThrow('scoped event failure');

    // Scope was properly disposed
    expect(disposedIds).toEqual([1]);

    await microservice.close();
  });
});
