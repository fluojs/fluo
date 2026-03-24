import { describe, expect, it, vi } from 'vitest';

import { RedisPubSubMicroserviceTransport } from './redis-transport.js';

interface RedisLike {
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
}

class InMemoryRedisBus {
  private readonly subscriberHandlers = new Set<(channel: string, message: string) => void>();

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
  it('supports request/reply send() with response correlation', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      if (packet.pattern === 'math.sum') {
        return input.a + input.b;
      }

      return input.a * input.b;
    });

    await expect(transport.send('math.sum', { a: 2, b: 5 })).resolves.toBe(7);
    await expect(transport.send('math.multiply', { a: 3, b: 4 })).resolves.toBe(12);

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
        return undefined;
      }

      return undefined;
    });

    await transport.emit('audit.value', { value: 9 });
    await transport.emit('audit.value', { value: 42 });
    expect(events).toEqual([{ value: 9 }, { value: 42 }]);

    await transport.close();
  });

  it('round-trips handler errors back to send() caller', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        throw new Error('Handler failure: invalid input');
      }

      return undefined;
    });

    await expect(transport.send('failing.pattern', {})).rejects.toThrow(
      'Handler failure: invalid input',
    );

    await transport.close();
  });

  it('rejects pending requests on timeout', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      requestTimeoutMs: 50,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => {});
    });

    await expect(transport.send('slow.pattern', {})).rejects.toThrow(
      /timed out after 50ms/,
    );

    await transport.close();
  });

  it('rejects pending requests with AbortSignal before publish', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('aborted.pattern', {}, controller.signal)).rejects.toThrow(
      'Redis request aborted before publish.',
    );

    await transport.close();
  });

  it('rejects pending requests with AbortSignal after publish', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'too-late';
    });

    const controller = new AbortController();
    const promise = transport.send('aborted.pattern', {}, controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    await expect(promise).rejects.toThrow('Redis request aborted.');

    await transport.close();
  });

  it('rejects all pending requests on close', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => {});
    });

    const promise1 = transport.send('pattern.one', {});
    const promise2 = transport.send('pattern.two', {});

    await transport.close();

    await expect(promise1).rejects.toThrow('Redis microservice transport closed before response.');
    await expect(promise2).rejects.toThrow('Redis microservice transport closed before response.');
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

    expect(subscribeClient.subscriptions.has('test-ns:requests')).toBe(true);
    expect(subscribeClient.subscriptions.has('test-ns:responses')).toBe(true);
    expect(subscribeClient.subscriptions.has('test-ns:events')).toBe(true);

    await transport.close();

    expect(subscribeClient.subscriptions.has('test-ns:requests')).toBe(false);
    expect(subscribeClient.subscriptions.has('test-ns:responses')).toBe(false);
    expect(subscribeClient.subscriptions.has('test-ns:events')).toBe(false);
  });

  it('does not send before listen() is called', async () => {
    const bus = new InMemoryRedisBus();
    const { publishClient, subscribeClient } = bus.createClient();

    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    await expect(transport.send('pattern', {})).rejects.toThrow(
      'RedisPubSubMicroserviceTransport is not listening. Call listen() before send().',
    );
  });
});
