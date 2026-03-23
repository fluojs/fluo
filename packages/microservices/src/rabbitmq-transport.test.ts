import { describe, expect, it } from 'vitest';

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

describe('RabbitMqMicroserviceTransport', () => {
  it('supports event emit and rejects send()', async () => {
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

  it('captures async callback rejections without leaking them to emit()', async () => {
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
