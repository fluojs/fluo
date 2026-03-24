import { describe, expect, it } from 'vitest';

import { RabbitMqMicroserviceTransport } from './rabbitmq-transport.js';

class InMemoryQueueBus {
  private readonly listeners = new Map<string, Set<(message: string) => Promise<void> | void>>();

  async publish(queue: string, message: string): Promise<void> {
    const handlers = this.listeners.get(queue);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(message);
    }
  }

  async subscribe(queue: string, handler: (message: string) => Promise<void> | void): Promise<void> {
    const handlers = this.listeners.get(queue) ?? new Set<(message: string) => Promise<void> | void>();
    handlers.add(handler);
    this.listeners.set(queue, handlers);
  }

  async unsubscribe(queue: string): Promise<void> {
    this.listeners.delete(queue);
  }
}

describe('RabbitMqMicroserviceTransport', () => {
  it('supports request/reply send() and event dispatch', async () => {
    const bus = new InMemoryQueueBus();
    const events: string[] = [];
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: string }).value);
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      return input.a + input.b;
    });

    await expect(transport.send('math.sum', { a: 2, b: 5 })).resolves.toBe(7);
    await transport.emit('audit.event', { value: 'ok' });
    expect(events).toEqual(['ok']);

    await transport.close();
  });

  it('round-trips handler failures to send() caller', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        throw new Error('rabbit handler failed');
      }

      return undefined;
    });

    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow('rabbit handler failed');

    await transport.close();
  });

  it('rejects pending requests on timeout', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
      requestTimeoutMs: 50,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => {});
    });

    await expect(transport.send('slow.pattern', {})).rejects.toThrow(
      /RabbitMQ request timed out after 50ms waiting for pattern "slow.pattern"/,
    );

    await transport.close();
  });

  it('supports concurrent request/reply flows with deterministic correlation', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind !== 'message') {
        return undefined;
      }

      const input = packet.payload as { delayMs: number; value: number };
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return input.value;
    });

    const first = transport.send('math.delayed', { delayMs: 40, value: 1 });
    const second = transport.send('math.delayed', { delayMs: 5, value: 2 });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);

    await transport.close();
  });

  it('ignores late replies after timeout and keeps later requests healthy', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
      requestTimeoutMs: 20,
    });

    await transport.listen(async (packet) => {
      if (packet.kind !== 'message') {
        return undefined;
      }

      if (packet.pattern === 'slow.once') {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return 'late';
      }

      return 'fast';
    });

    await expect(transport.send('slow.once', {})).rejects.toThrow(
      /RabbitMQ request timed out after 20ms waiting for pattern "slow.once"/,
    );
    await expect(transport.send('fast.next', {})).resolves.toBe('fast');

    await transport.close();
  });

  it('rejects all pending requests on shutdown', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => {});
    });

    const first = transport.send('never.one', {});
    const second = transport.send('never.two', {});

    await transport.close();

    await expect(first).rejects.toThrow('RabbitMQ microservice transport closed before response.');
    await expect(second).rejects.toThrow('RabbitMQ microservice transport closed before response.');
  });

  it('documents startup/reconnect/shutdown queue lifecycle behavior', async () => {
    const bus = new InMemoryQueueBus();
    const consumedQueues: string[] = [];
    const cancelledQueues: string[] = [];
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          cancelledQueues.push(queue);
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          consumedQueues.push(queue);
          await bus.subscribe(queue, handler);
        },
      },
      eventQueue: 'test.events',
      messageQueue: 'test.messages',
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
      responseQueue: 'test.responses',
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return 'pong';
      }

      return undefined;
    });

    expect(consumedQueues.sort()).toEqual(['test.events', 'test.messages', 'test.responses']);
    await expect(transport.send('health.ping', {})).resolves.toBe('pong');

    await transport.close();

    expect(cancelledQueues.sort()).toEqual(['test.events', 'test.messages', 'test.responses']);

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return 'reconnected';
      }

      return undefined;
    });

    await expect(transport.send('health.ping', {})).resolves.toBe('reconnected');
    await transport.close();

    expect(consumedQueues).toHaveLength(6);
    expect(cancelledQueues).toHaveLength(6);
  });

  it('rejects send() before listen()', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
    });

    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(
      'RabbitMqMicroserviceTransport is not listening. Call listen() before send().',
    );
  });

  it('captures async event-handler failures without leaking them to emit()', async () => {
    const bus = new InMemoryQueueBus();
    const transport = new RabbitMqMicroserviceTransport({
      consumer: {
        async cancel(queue) {
          await bus.unsubscribe(queue);
        },
        async consume(queue, handler) {
          await bus.subscribe(queue, handler);
        },
      },
      publisher: {
        async publish(queue, message) {
          await bus.publish(queue, message);
        },
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('rabbit event handler failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.logout', { value: 'bye' })).resolves.toBeUndefined();

    await transport.close();
  });
});
