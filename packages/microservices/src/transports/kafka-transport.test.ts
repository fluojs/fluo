import { describe, expect, it } from 'vitest';

import { KafkaMicroserviceTransport, type KafkaMicroserviceTransportOptions } from './kafka-transport.js';

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

function createTransport(
  bus: InMemoryTopicBus,
  options: Partial<KafkaMicroserviceTransportOptions> = {},
): { published: Array<{ message: string; topic: string }>; transport: KafkaMicroserviceTransport } {
  const published: Array<{ message: string; topic: string }> = [];

  const transport = new KafkaMicroserviceTransport({
    consumer: {
      subscribe: async (topic, handler) => {
        await bus.subscribe(topic, handler);
      },
      unsubscribe: async (topic) => {
        await bus.unsubscribe(topic);
      },
    },
    eventTopic: options.eventTopic,
    messageTopic: options.messageTopic,
    producer: {
      publish: async (topic, message) => {
        published.push({ topic, message });
        await bus.publish(topic, message);
      },
    },
    requestTimeoutMs: options.requestTimeoutMs,
    responseTopic: options.responseTopic,
  });

  return { published, transport };
}

describe('KafkaMicroserviceTransport', () => {
  it('supports request/reply send() and event dispatch', async () => {
    const bus = new InMemoryTopicBus();
    const received: string[] = [];
    const { published, transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
      responseTopic: 'konekti.microservices.responses.client-a',
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        received.push((packet.payload as { message: string }).message);
        return undefined;
      }

      if (packet.pattern === 'math.sum') {
        const input = packet.payload as { a: number; b: number };
        return input.a + input.b;
      }

      return 'ok';
    });

    await transport.emit('audit.login', { message: 'ok' });
    await expect(transport.send('math.sum', { a: 1, b: 2 })).resolves.toBe(3);

    expect(received).toEqual(['ok']);

    const requestFrame = published
      .map(({ message, topic }) => ({
        payload: JSON.parse(message) as {
          kind?: string;
          replyTopic?: string;
          requestId?: string;
        },
        topic,
      }))
      .find((entry) => entry.payload.kind === 'message');

    expect(requestFrame?.topic).toBe('konekti.microservices.messages');
    expect(requestFrame?.payload.replyTopic).toBe('konekti.microservices.responses.client-a');
    expect(typeof requestFrame?.payload.requestId).toBe('string');

    await transport.close();
  });

  it('round-trips request handler failures back to send() caller', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => {
      throw new Error('kafka handler failed');
    });

    await expect(transport.send('audit.login', { message: 'ok' })).rejects.toThrow('kafka handler failed');

    await transport.close();
  });

  it('rejects send() before listen()', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus);

    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(
      'KafkaMicroserviceTransport is not listening. Call listen() before send().',
    );
  });

  it('rejects pending request on timeout', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 30,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    await expect(transport.send('slow.request', { value: 1 })).rejects.toThrow(
      'Kafka request timed out after 30ms waiting for pattern "slow.request".',
    );

    await transport.close();
  });

  it('rejects send() with AbortSignal before publish', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('aborted.before.publish', {}, controller.signal)).rejects.toThrow(
      'Kafka request aborted before publish.',
    );

    await transport.close();
  });

  it('rejects send() with AbortSignal after publish', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    const controller = new AbortController();
    const pending = transport.send('aborted.inflight', {}, controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toThrow('Kafka request aborted.');

    await transport.close();
  });

  it('keeps concurrent request/reply flows correlated by requestId', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 2_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        return undefined;
      }

      const input = packet.payload as { delayMs: number; value: number };
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return input.value * 2;
    });

    const [first, second] = await Promise.all([
      transport.send('calc.double', { value: 1, delayMs: 100 }),
      transport.send('calc.double', { value: 2, delayMs: 10 }),
    ]);

    expect(first).toBe(2);
    expect(second).toBe(4);

    await transport.close();
  });

  it('rejects pending requests when close() runs before a reply', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    const pending = transport.send('long.running', { value: 1 });
    await transport.close();

    await expect(pending).rejects.toThrow(/Kafka microservice transport closed before/);
  });

  it('still rejects pending requests when unsubscribe fails during close', async () => {
    const bus = new InMemoryTopicBus();
    const closeError = new Error('unsubscribe failed');
    const consumer = {
      subscribe: async (topic: string, handler: (message: string) => Promise<void> | void) => {
        await bus.subscribe(topic, handler);
      },
      unsubscribe: async (topic: string) => {
        await bus.unsubscribe(topic);
        throw closeError;
      },
    };
    const transport = new KafkaMicroserviceTransport({
      consumer,
      producer: {
        publish: async (topic, message) => {
          await bus.publish(topic, message);
        },
      },
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    const pending = transport.send('long.running', { value: 1 });

    await expect(transport.close()).rejects.toBe(closeError);
    await expect(pending).rejects.toThrow(/Kafka microservice transport closed before/);
  });

  it('does not publish request frames once close() starts', async () => {
    const bus = new InMemoryTopicBus();
    const { published, transport } = createTransport(bus, {
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    const pending = transport.send('close.race', { value: 1 });
    await transport.close();

    await expect(pending).rejects.toThrow(/closed before/);

    const requestFrames = published.filter(({ message }) => {
      const frame = JSON.parse(message) as { kind?: string };
      return frame.kind === 'message';
    });

    expect(requestFrames).toHaveLength(0);
  });

  it('captures async callback rejections without leaking them to emit()', async () => {
    const bus = new InMemoryTopicBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => {
      throw new Error('kafka handler failed');
    });

    await expect(transport.emit('audit.login', { message: 'ok' })).resolves.toBeUndefined();

    await transport.close();
  });

  it('unsubscribes already-subscribed topics when a later subscribe fails during listen()', async () => {
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    let callCount = 0;

    const transport = new KafkaMicroserviceTransport({
      consumer: {
        subscribe: async (topic) => {
          callCount++;

          if (callCount === 2) {
            throw new Error('subscribe failed on second topic');
          }

          subscribed.push(topic);
        },
        unsubscribe: async (topic) => {
          unsubscribed.push(topic);
        },
      },
      producer: {
        publish: async () => {},
      },
    });

    await expect(transport.listen(() => Promise.resolve(undefined))).rejects.toThrow('subscribe failed on second topic');

    expect(subscribed).toHaveLength(1);
    expect(unsubscribed).toEqual(subscribed);
  });
});
