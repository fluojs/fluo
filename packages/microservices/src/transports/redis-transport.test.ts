import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisPubSubMicroserviceTransport } from './redis-transport.js';

interface RedisLike {
  off?(event: 'message', listener: (channel: string, message: string) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
}

class InMemoryRedisBus {
  private readonly subscriberHandlers = new Set<(channel: string, message: string) => void>();

  listenerCount(): number {
    return this.subscriberHandlers.size;
  }

  createClient(): {
    publishClient: RedisLike;
    subscribeClient: RedisLike & { subscriptions: Set<string> };
  } {
    const subscriptions = new Set<string>();

    return {
      publishClient: {
        on: () => {},
        publish: async (channel: string, message: string) => {
          for (const handler of this.subscriberHandlers) {
            handler(channel, message);
          }
        },
        subscribe: async () => {},
        unsubscribe: async () => {},
      },
      subscribeClient: {
        on: (event: 'message', listener: (channel: string, message: string) => void) => {
          if (event === 'message') {
            this.subscriberHandlers.add(listener);
          }
        },
        off: (event: 'message', listener: (channel: string, message: string) => void) => {
          if (event === 'message') {
            this.subscriberHandlers.delete(listener);
          }
        },
        publish: async () => {},
        subscribe: async (...channels: string[]) => {
          for (const channel of channels) {
            subscriptions.add(channel);
          }
        },
        unsubscribe: async (...channels: string[]) => {
          for (const channel of channels) {
            subscriptions.delete(channel);
          }
        },
        subscriptions,
      },
    };
  }
}

describe('RedisPubSubMicroserviceTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects send() because Redis Pub/Sub request/reply is intentionally unsupported', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    await transport.listen(async () => undefined);

    await expect(transport.send('math.sum', { a: 2, b: 5 })).rejects.toThrow(
      'RedisPubSubMicroserviceTransport does not support request/reply send().',
    );

    await transport.close();
  });

  it('supports emit() for event fan-out', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    const events: unknown[] = [];
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push(packet.payload);
      }

      return undefined;
    });

    await transport.emit('audit.value', { value: 9 });
    await transport.emit('audit.value', { value: 42 });
    expect(events).toEqual([{ value: 9 }, { value: 42 }]);

    await transport.close();
  });

  it('isolates event handler failures from the Redis message listener', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });
    const logger = { error: vi.fn() };
    transport.setLogger(logger);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('redis event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'redis event failed' }),
      'RedisPubSubMicroserviceTransport',
    );

    await transport.close();
  });

  it('cleans up subscriptions on close', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      namespace: 'test-ns',
    });

    await transport.listen(async () => undefined);

    expect(subscribeClient.subscriptions.has('test-ns:events')).toBe(true);

    await transport.close();

    expect(subscribeClient.subscriptions.has('test-ns:events')).toBe(false);
  });

  it('removes the message listener on close so reconnect does not duplicate event dispatch', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    let handled = 0;

    const handler = async (packet: Parameters<typeof transport.listen>[0] extends (arg: infer T) => unknown ? T : never) => {
      if (packet.kind === 'event' && packet.pattern === 'audit.value') {
        handled += 1;
      }

      return undefined;
    };

    await transport.listen(handler);
    expect(bus.listenerCount()).toBe(1);

    await transport.close();
    expect(bus.listenerCount()).toBe(0);

    await transport.listen(handler);
    expect(bus.listenerCount()).toBe(1);

    await transport.emit('audit.value', { value: 7 });
    expect(handled).toBe(1);

    await transport.close();
    expect(bus.listenerCount()).toBe(0);
  });

  it('still removes the listener and subscriptions when unsubscribe fails during close', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();
    const closeError = new Error('unsubscribe failed');
    const originalUnsubscribe = subscribeClient.unsubscribe.bind(subscribeClient);
    subscribeClient.unsubscribe = vi.fn(async (...channels: string[]) => {
      await originalUnsubscribe(...channels);
      throw closeError;
    });

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      namespace: 'test-ns',
    });

    await transport.listen(async () => undefined);
    expect(bus.listenerCount()).toBe(1);

    await expect(transport.close()).rejects.toBe(closeError);

    expect(bus.listenerCount()).toBe(0);
    expect(subscribeClient.subscriptions.has('test-ns:events')).toBe(false);
  });
});
