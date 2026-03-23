import { describe, expect, it } from 'vitest';

import { KafkaMicroserviceTransport } from './kafka-transport.js';

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

describe('KafkaMicroserviceTransport', () => {
  it('supports event emit and rejects send()', async () => {
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

  it('captures async callback rejections without leaking them to emit()', async () => {
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
});
