import { TextDecoder, TextEncoder } from 'node:util';

import { describe, expect, it } from 'vitest';

import { KafkaMicroserviceTransport } from './kafka-transport.js';
import { NatsMicroserviceTransport } from './nats-transport.js';
import { RabbitMqMicroserviceTransport } from './rabbitmq-transport.js';

class InMemoryTopicBus {
  private readonly listeners = new Map<string, Set<(message: string) => Promise<void> | void>>();

  async publish(topic: string, message: string): Promise<void> {
    const handlers = this.listeners.get(topic);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      await handler(message);
    }
  }

  async subscribe(topic: string, handler: (message: string) => Promise<void> | void): Promise<void> {
    const handlers = this.listeners.get(topic) ?? new Set<(message: string) => Promise<void> | void>();
    handlers.add(handler);
    this.listeners.set(topic, handlers);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.listeners.delete(topic);
  }
}

class InMemoryNatsClient {
  private readonly subscriptions = new Map<string, Set<(message: { data: Uint8Array; respond(data: Uint8Array): void }) => void>>();

  subscribe(subject: string, handler: (message: { data: Uint8Array; respond(data: Uint8Array): void }) => void) {
    const handlers = this.subscriptions.get(subject) ?? new Set<typeof handler>();
    handlers.add(handler);
    this.subscriptions.set(subject, handlers);

    return {
      unsubscribe: () => {
        const currentHandlers = this.subscriptions.get(subject);
        if (!currentHandlers) {
          return;
        }

        currentHandlers.delete(handler);

        if (currentHandlers.size === 0) {
          this.subscriptions.delete(subject);
        }
      },
    };
  }

  publish(subject: string, payload: Uint8Array): void {
    const handlers = this.subscriptions.get(subject);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler({
        data: payload,
        respond: () => {
          return;
        },
      });
    }
  }

  async request(subject: string, payload: Uint8Array): Promise<{ data: Uint8Array }> {
    const handlers = this.subscriptions.get(subject);

    if (!handlers || handlers.size === 0) {
      throw new Error(`No NATS subscribers for subject ${subject}.`);
    }

    return await new Promise<{ data: Uint8Array }>((resolve) => {
      const first = handlers.values().next().value as
        | ((message: { data: Uint8Array; respond(data: Uint8Array): void }) => void)
        | undefined;

      if (!first) {
        resolve({ data: new Uint8Array() });
        return;
      }

      first({
        data: payload,
        respond(data) {
          resolve({ data });
        },
      });
    });
  }

  close(): void {
    this.subscriptions.clear();
  }
}

describe('broker transport adapters', () => {
  it('supports NATS request/reply and event dispatch', async () => {
    const nats = new InMemoryNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const events: number[] = [];

    const transport = new NatsMicroserviceTransport({ client: nats, codec });
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: number }).value);
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      return input.a + input.b;
    });

    await expect(transport.send('math.sum', { a: 2, b: 5 })).resolves.toBe(7);
    await transport.emit('audit.value', { value: 9 });
    expect(events).toEqual([9]);

    await transport.close();
  });

  it('supports Kafka event emit and rejects send()', async () => {
    const bus = new InMemoryTopicBus();
    const received: string[] = [];
    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic, handler) => {
          await bus.subscribe(topic, handler);
        },
        unsubscribe: async (topic) => {
          await bus.unsubscribe(topic);
        },
      },
      producer: {
        publish: async (topic, message) => {
          await bus.publish(topic, message);
        },
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        received.push((packet.payload as { message: string }).message);
      }
      return undefined;
    });

    await transport.emit('audit.login', { message: 'ok' });
    expect(received).toEqual(['ok']);
    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(
      'does not support request/reply send()',
    );

    await transport.close();
  });

  it('supports RabbitMQ event emit and rejects send()', async () => {
    const bus = new InMemoryTopicBus();
    const received: string[] = [];
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
        received.push((packet.payload as { message: string }).message);
      }
      return undefined;
    });

    await transport.emit('audit.logout', { message: 'bye' });
    expect(received).toEqual(['bye']);
    await expect(transport.send('math.sum', { a: 3, b: 3 })).rejects.toThrow(
      'does not support request/reply send()',
    );

    await transport.close();
  });

  it('captures Kafka async callback rejections without leaking them to emit()', async () => {
    const bus = new InMemoryTopicBus();
    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic, handler) => {
          await bus.subscribe(topic, handler);
        },
        unsubscribe: async (topic) => {
          await bus.unsubscribe(topic);
        },
      },
      producer: {
        publish: async (topic, message) => {
          await bus.publish(topic, message);
        },
      },
    });

    await transport.listen(async () => {
      throw new Error('kafka handler failed');
    });

    await expect(transport.emit('audit.login', { message: 'ok' })).resolves.toBeUndefined();

    await transport.close();
  });

  it('captures RabbitMQ async callback rejections without leaking them to emit()', async () => {
    const bus = new InMemoryTopicBus();
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

    await transport.listen(async () => {
      throw new Error('rabbit handler failed');
    });

    await expect(transport.emit('audit.logout', { message: 'bye' })).resolves.toBeUndefined();

    await transport.close();
  });
});
