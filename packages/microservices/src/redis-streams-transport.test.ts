import { describe, expect, it } from 'vitest';

import {
  RedisStreamsMicroserviceTransport,
  type RedisStreamsMicroserviceTransportOptions,
  type RedisStreamClientLike,
} from './redis-streams-transport.js';

interface InMemoryStreamEntry {
  readonly fields: Record<string, string>;
  readonly id: string;
}

class InMemoryStreamBus implements RedisStreamClientLike {
  private readonly groupStartIndices = new Map<string, number>();
  private readonly groupToConsumerPositions = new Map<string, Map<string, number>>();
  private readonly streamCounters = new Map<string, number>();
  private readonly streams = new Map<string, InMemoryStreamEntry[]>();

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const entries = this.streams.get(stream) ?? [];
    const next = (this.streamCounters.get(stream) ?? 0) + 1;
    this.streamCounters.set(stream, next);

    const id = `0-${String(next)}`;
    entries.push({
      id,
      fields: { ...fields },
    });

    this.streams.set(stream, entries);
    return id;
  }

  async xreadgroup(
    group: string,
    consumer: string,
    streams: readonly string[],
    options?: { blockMs?: number; count?: number },
  ): Promise<readonly InMemoryStreamEntry[] | null> {
    const count = options?.count ?? 1;
    const results: InMemoryStreamEntry[] = [];

    for (const stream of streams) {
      const groupKey = this.getGroupKey(stream, group);
      const consumerPositions = this.groupToConsumerPositions.get(groupKey);

      if (!consumerPositions) {
        throw new Error(`NOGROUP ${groupKey}`);
      }

      const streamEntries = this.streams.get(stream) ?? [];
      const startIndex = this.groupStartIndices.get(groupKey) ?? 0;
      const previousIndex = consumerPositions.get(consumer) ?? (startIndex - 1);
      const nextIndex = previousIndex + 1;
      const readable = streamEntries.slice(nextIndex, nextIndex + count);

      if (readable.length === 0) {
        continue;
      }

      consumerPositions.set(consumer, nextIndex + readable.length - 1);

      for (const entry of readable) {
        results.push({
          id: entry.id,
          fields: { ...entry.fields },
        });
      }
    }

    return results.length > 0 ? results : null;
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    void stream;
    void group;
    void id;
  }

  async xgroupCreate(stream: string, group: string, startId: string, mkstream: boolean): Promise<void> {
    if (!this.streams.has(stream)) {
      if (!mkstream) {
        throw new Error(`NOSTREAM ${stream}`);
      }

      this.streams.set(stream, []);
      this.streamCounters.set(stream, 0);
    }

    const groupKey = this.getGroupKey(stream, group);

    if (this.groupToConsumerPositions.has(groupKey)) {
      return;
    }

    const streamEntries = this.streams.get(stream) ?? [];
    const startIndex = this.resolveStartIndex(streamEntries, startId);

    this.groupToConsumerPositions.set(groupKey, new Map<string, number>());
    this.groupStartIndices.set(groupKey, startIndex);
  }

  async xgroupDestroy(stream: string, group: string): Promise<void> {
    const groupKey = this.getGroupKey(stream, group);
    this.groupToConsumerPositions.delete(groupKey);
    this.groupStartIndices.delete(groupKey);
  }

  private getGroupKey(stream: string, group: string): string {
    return `${stream}::${group}`;
  }

  private resolveStartIndex(entries: readonly InMemoryStreamEntry[], startId: string): number {
    if (startId === '$') {
      return entries.length;
    }

    if (startId === '0' || startId === '0-0') {
      return 0;
    }

    const parsed = Number.parseInt(startId.split('-')[1] ?? '0', 10);

    if (Number.isNaN(parsed) || parsed <= 0) {
      return 0;
    }

    return Math.min(entries.length, parsed);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createTransport(
  bus: InMemoryStreamBus,
  options: Partial<RedisStreamsMicroserviceTransportOptions> = {},
): { published: Array<{ fields: Record<string, string>; stream: string }>; transport: RedisStreamsMicroserviceTransport } {
  const published: Array<{ fields: Record<string, string>; stream: string }> = [];

  const readerClient = options.readerClient ?? bus;
  const writerClient = options.writerClient ?? {
    xadd: async (stream: string, fields: Record<string, string>) => {
      published.push({ stream, fields: { ...fields } });
      return await bus.xadd(stream, fields);
    },
    xreadgroup: async (group, consumer, streams, readOptions) => {
      return await bus.xreadgroup(group, consumer, streams, readOptions);
    },
    xack: async (stream, group, id) => {
      await bus.xack(stream, group, id);
    },
    xgroupCreate: async (stream, group, startId, mkstream) => {
      await bus.xgroupCreate(stream, group, startId, mkstream);
    },
    xgroupDestroy: async (stream, group) => {
      await bus.xgroupDestroy(stream, group);
    },
  } satisfies RedisStreamClientLike;

  const transport = new RedisStreamsMicroserviceTransport({
    consumerGroup: options.consumerGroup,
    namespace: options.namespace,
    pollBlockMs: options.pollBlockMs ?? 1,
    readerClient,
    requestTimeoutMs: options.requestTimeoutMs,
    writerClient,
  });

  return { published, transport };
}

describe('RedisStreamsMicroserviceTransport', () => {
  it('supports request/reply send() and event dispatch', async () => {
    const bus = new InMemoryStreamBus();
    const received: string[] = [];
    const { published, transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
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
    await sleep(50);

    expect(received).toEqual(['ok']);

    const requestFrame = published.find((entry) => entry.fields.kind === 'message');

    expect(requestFrame?.stream).toBe('konekti:streams:messages');
    expect(requestFrame?.fields.replyStream).toMatch(/^konekti:streams:responses:/);
    expect(typeof requestFrame?.fields.requestId).toBe('string');

    await transport.close();
  });

  it('round-trips request handler failures back to send() caller', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => {
      throw new Error('redis streams handler failed');
    });

    await expect(transport.send('audit.login', { message: 'ok' })).rejects.toThrow('redis streams handler failed');

    await transport.close();
  });

  it('rejects send() before listen()', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus);

    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(
      'RedisStreamsMicroserviceTransport is not listening. Call listen() before send().',
    );
  });

  it('rejects pending request on timeout', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 30,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await sleep(120);
      }

      return undefined;
    });

    await expect(transport.send('slow.request', { value: 1 })).rejects.toThrow(
      'Redis Streams request timed out after 30ms waiting for pattern "slow.request".',
    );

    await transport.close();
  });

  it('rejects send() with AbortSignal before publish', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('aborted.before.publish', {}, controller.signal)).rejects.toThrow(
      'Redis Streams request aborted before publish.',
    );

    await transport.close();
  });

  it('rejects send() with AbortSignal after publish', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await sleep(200);
      }

      return undefined;
    });

    const controller = new AbortController();
    const pending = transport.send('aborted.inflight', {}, controller.signal);

    await sleep(20);
    controller.abort();

    await expect(pending).rejects.toThrow('Redis Streams request aborted.');

    await transport.close();
  });

  it('keeps concurrent request/reply flows correlated by requestId', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 2_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        return undefined;
      }

      const input = packet.payload as { delayMs: number; value: number };
      await sleep(input.delayMs);
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
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await sleep(300);
      }

      return undefined;
    });

    const pending = transport.send('long.running', { value: 1 });
    await sleep(20);
    await transport.close();

    await expect(pending).rejects.toThrow(/Redis Streams microservice transport closed before/);
  });

  it('still rejects pending requests when group destroy fails during close', async () => {
    const bus = new InMemoryStreamBus();
    const closeError = new Error('group destroy failed');
    const transport = new RedisStreamsMicroserviceTransport({
      pollBlockMs: 1,
      readerClient: {
        xadd: async (stream, fields) => {
          return await bus.xadd(stream, fields);
        },
        xreadgroup: async (group, consumer, streams, options) => {
          return await bus.xreadgroup(group, consumer, streams, options);
        },
        xack: async (stream, group, id) => {
          await bus.xack(stream, group, id);
        },
        xgroupCreate: async (stream, group, startId, mkstream) => {
          await bus.xgroupCreate(stream, group, startId, mkstream);
        },
        xgroupDestroy: async (stream, group) => {
          await bus.xgroupDestroy(stream, group);
          throw closeError;
        },
      },
      requestTimeoutMs: 5_000,
      writerClient: {
        xadd: async (stream, fields) => {
          return await bus.xadd(stream, fields);
        },
        xreadgroup: async (group, consumer, streams, options) => {
          return await bus.xreadgroup(group, consumer, streams, options);
        },
        xack: async (stream, group, id) => {
          await bus.xack(stream, group, id);
        },
        xgroupCreate: async (stream, group, startId, mkstream) => {
          await bus.xgroupCreate(stream, group, startId, mkstream);
        },
        xgroupDestroy: async (stream, group) => {
          await bus.xgroupDestroy(stream, group);
        },
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        await sleep(300);
      }

      return undefined;
    });

    const pending = transport.send('long.running', { value: 1 });
    await sleep(20);

    await expect(transport.close()).rejects.toBe(closeError);
    await expect(pending).rejects.toThrow(/Redis Streams microservice transport closed before/);
  });

  it('captures async callback rejections without leaking them to emit()', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => {
      throw new Error('redis streams event handler failed');
    });

    await expect(transport.emit('audit.login', { message: 'ok' })).resolves.toBeUndefined();
    await sleep(30);

    await transport.close();
  });
});
