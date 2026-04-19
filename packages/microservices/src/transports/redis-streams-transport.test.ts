import { describe, expect, it, vi } from 'vitest';

import {
  RedisStreamsMicroserviceTransport,
  type RedisStreamWriteOptions,
  type RedisStreamsMicroserviceTransportOptions,
  type RedisStreamClientLike,
} from './redis-streams-transport.js';

interface InMemoryStreamEntry {
  deleted?: boolean;
  readonly fields: Record<string, string>;
  readonly id: string;
}

class InMemoryStreamBus implements RedisStreamClientLike {
  private readonly groupStartIndices = new Map<string, number>();
  private readonly groupToConsumerPositions = new Map<string, Map<string, number>>();
  private readonly streamCounters = new Map<string, number>();
  private readonly streams = new Map<string, InMemoryStreamEntry[]>();
  private readonly values = new Map<string, string>();

  async xadd(stream: string, fields: Record<string, string>, options?: RedisStreamWriteOptions): Promise<string> {
    const entries = this.streams.get(stream) ?? [];
    const next = (this.streamCounters.get(stream) ?? 0) + 1;
    this.streamCounters.set(stream, next);

    const id = `0-${String(next)}`;
    entries.push({
      id,
      fields: { ...fields },
    });

    const maxLenApproximate = options?.maxLenApproximate;

    if (typeof maxLenApproximate === 'number' && maxLenApproximate > 0 && entries.length > maxLenApproximate) {
      entries.splice(0, entries.length - maxLenApproximate);
    }

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
      let lastVisitedIndex = previousIndex;

      for (let index = nextIndex; index < streamEntries.length && results.length < count; index += 1) {
        lastVisitedIndex = index;
        const entry = streamEntries[index];

        if (!entry || entry.deleted) {
          continue;
        }

        results.push({
          id: entry.id,
          fields: { ...entry.fields },
        });
      }

      if (lastVisitedIndex < nextIndex) {
        continue;
      }

      consumerPositions.set(consumer, lastVisitedIndex);
    }

    return results.length > 0 ? results : null;
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    void stream;
    void group;
    void id;
  }

  async xdel(stream: string, id: string): Promise<void> {
    const entries = this.streams.get(stream);

    if (!entries) {
      return;
    }

    const index = entries.findIndex((entry) => entry.id === id);

    if (index >= 0) {
      entries[index] = {
        ...entries[index],
        deleted: true,
      };
    }
  }

  async del(stream: string): Promise<void> {
    this.values.delete(stream);
    this.streams.delete(stream);
    this.streamCounters.delete(stream);

    for (const key of [...this.groupStartIndices.keys()]) {
      if (key.startsWith(`${stream}::`)) {
        this.groupStartIndices.delete(key);
      }
    }

    for (const key of [...this.groupToConsumerPositions.keys()]) {
      if (key.startsWith(`${stream}::`)) {
        this.groupToConsumerPositions.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async incr(key: string): Promise<number> {
    const nextValue = Number.parseInt(this.values.get(key) ?? '0', 10) + 1;
    this.values.set(key, String(nextValue));
    return nextValue;
  }

  async decr(key: string): Promise<number> {
    const nextValue = Number.parseInt(this.values.get(key) ?? '0', 10) - 1;
    this.values.set(key, String(nextValue));
    return nextValue;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
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
      throw new Error(`BUSYGROUP Consumer Group name already exists for ${groupKey}`);
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

  getStreamEntries(stream: string): readonly InMemoryStreamEntry[] {
    return (this.streams.get(stream) ?? []).filter((entry) => !entry.deleted);
  }

  getStreamNames(): readonly string[] {
    return [...this.streams.keys()];
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
): { published: Array<{ fields: Record<string, string>; options?: RedisStreamWriteOptions; stream: string }>; transport: RedisStreamsMicroserviceTransport } {
  const published: Array<{ fields: Record<string, string>; options?: RedisStreamWriteOptions; stream: string }> = [];

  const readerClient = options.readerClient ?? bus;
  const writerClient = options.writerClient ?? {
    xadd: async (stream: string, fields: Record<string, string>, writeOptions?: RedisStreamWriteOptions) => {
      published.push({ stream, fields: { ...fields }, options: writeOptions });
      return await bus.xadd(stream, fields, writeOptions);
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
    eventRetentionMaxLen: options.eventRetentionMaxLen,
    messageRetentionMaxLen: options.messageRetentionMaxLen,
    namespace: options.namespace,
    pollBlockMs: options.pollBlockMs ?? 1,
    readerClient,
    responseRetentionMaxLen: options.responseRetentionMaxLen,
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

    expect(requestFrame?.stream).toBe('fluo:streams:messages');
    expect(requestFrame?.fields.replyStream).toMatch(/^fluo:streams:responses:/);
    expect(typeof requestFrame?.fields.requestId).toBe('string');

    const responseFrame = published.find((entry) => entry.stream.startsWith('fluo:streams:responses:'));

    expect(requestFrame?.options?.maxLenApproximate).toBeUndefined();
    expect(responseFrame?.options?.maxLenApproximate).toBe(1_000);

    await transport.close();
  });

  it('keeps live request and event streams untrimmed by default while cleaning up acked request/reply entries', async () => {
    const bus = new InMemoryStreamBus();
    const { published, transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
      responseRetentionMaxLen: 1,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await transport.emit('audit.event', { value: 1 });
    await transport.emit('audit.event', { value: 2 });
    await transport.emit('audit.event', { value: 3 });

    await expect(transport.send('audit.message', { value: 1 })).resolves.toEqual({ value: 1 });
    await sleep(50);

    expect(bus.getStreamEntries('fluo:streams:events')).toHaveLength(3);
    expect(bus.getStreamEntries('fluo:streams:messages')).toHaveLength(0);

    const eventFrames = published.filter((entry) => entry.stream === 'fluo:streams:events');
    const requestFrame = published.find((entry) => entry.stream === 'fluo:streams:messages');
    const responseFrame = published.find((entry) => entry.stream.startsWith('fluo:streams:responses:'));

    expect(eventFrames).toHaveLength(3);
    expect(eventFrames.every((entry) => entry.options?.maxLenApproximate === undefined)).toBe(true);
    expect(requestFrame?.options?.maxLenApproximate).toBeUndefined();
    expect(responseFrame?.options?.maxLenApproximate).toBe(1);

    const responseStream = bus.getStreamNames().find((name) => name.startsWith('fluo:streams:responses:'));
    expect(responseStream).toBeTypeOf('string');

    if (!responseStream) {
      throw new Error('expected a response stream to exist');
    }

    expect(bus.getStreamEntries(responseStream)).toHaveLength(0);

    await transport.close();
  });

  it('allows callers to opt into publish-time trimming overrides for live request and event streams', async () => {
    const bus = new InMemoryStreamBus();
    const { published, transport } = createTransport(bus, {
      eventRetentionMaxLen: 2,
      messageRetentionMaxLen: 2,
      requestTimeoutMs: 1_000,
      responseRetentionMaxLen: 1,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await transport.emit('audit.event', { value: 1 });
    await transport.emit('audit.event', { value: 2 });
    await transport.emit('audit.event', { value: 3 });

    await expect(transport.send('audit.message', { value: 1 })).resolves.toEqual({ value: 1 });
    await sleep(50);

    const eventFrames = published.filter((entry) => entry.stream === 'fluo:streams:events');
    const requestFrame = published.find((entry) => entry.stream === 'fluo:streams:messages');
    const responseFrame = published.find((entry) => entry.stream.startsWith('fluo:streams:responses:'));

    expect(bus.getStreamEntries('fluo:streams:events')).toHaveLength(2);
    expect(eventFrames.every((entry) => entry.options?.maxLenApproximate === 2)).toBe(true);
    expect(requestFrame?.options?.maxLenApproximate).toBe(2);
    expect(responseFrame?.options?.maxLenApproximate).toBe(1);

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

  it('acks request entries only after the handler finishes', async () => {
    const bus = new InMemoryStreamBus();
    const acknowledgements: Array<{ group: string; id: string; stream: string }> = [];
    let releaseHandler: (() => void) | undefined;
    const handlerFinished = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

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
          acknowledgements.push({ group, id, stream });
          await bus.xack(stream, group, id);
        },
        xgroupCreate: async (stream, group, startId, mkstream) => {
          await bus.xgroupCreate(stream, group, startId, mkstream);
        },
        xgroupDestroy: async (stream, group) => {
          await bus.xgroupDestroy(stream, group);
        },
      },
      requestTimeoutMs: 1_000,
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
        await handlerFinished;
        return 'ok';
      }

      return undefined;
    });

    const pending = transport.send('delayed.ack', { value: 1 });
    await sleep(20);
    expect(acknowledgements).toEqual([]);

    releaseHandler?.();

    await expect(pending).resolves.toBe('ok');
    await sleep(20);

    expect(acknowledgements.some((entry) => entry.stream === 'fluo:streams:messages')).toBe(true);

    await transport.close();
  });

  it('keeps failed events pending by skipping ack when the handler rejects', async () => {
    const bus = new InMemoryStreamBus();
    const acknowledgements: string[] = [];
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
          acknowledgements.push(`${stream}:${group}:${id}`);
          await bus.xack(stream, group, id);
        },
        xgroupCreate: async (stream, group, startId, mkstream) => {
          await bus.xgroupCreate(stream, group, startId, mkstream);
        },
        xgroupDestroy: async (stream, group) => {
          await bus.xgroupDestroy(stream, group);
        },
      },
      requestTimeoutMs: 1_000,
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
    const logger = { error: vi.fn() };

    transport.setLogger(logger);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('event failed');
      }

      return undefined;
    });

    await transport.emit('audit.failed', { value: 1 });
    await sleep(20);

    expect(acknowledgements.some((entry) => entry.startsWith('fluo:streams:events:'))).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'event failed' }),
      'RedisStreamsMicroserviceTransport',
    );

    await transport.close();
  });

  it('deletes the per-consumer response stream on close()', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await expect(transport.send('cleanup.response.stream', { ok: true })).resolves.toEqual({ ok: true });
    await sleep(20);

    const responseStream = bus.getStreamNames().find((name) => name.startsWith('fluo:streams:responses:'));
    expect(responseStream).toBeTypeOf('string');

    if (!responseStream) {
      throw new Error('expected a response stream to exist before close');
    }

    await transport.close();

    expect(bus.getStreamNames()).not.toContain(responseStream);
  });

  it('destroys the request consumer group on close so repeated listen/close cycles do not leak BUSYGROUP state', async () => {
    const groupKeys = new Set<string>();
    const destroyedGroups: string[] = [];

    const createStrictClient = (): RedisStreamClientLike => ({
      xadd: async () => '0-1',
      xreadgroup: async () => null,
      xack: async () => {},
      del: async () => {},
      xgroupCreate: async (stream, group) => {
        const key = `${stream}::${group}`;

        if (groupKeys.has(key)) {
          throw new Error(`BUSYGROUP Consumer Group name already exists for ${key}`);
        }

        groupKeys.add(key);
      },
      xgroupDestroy: async (stream, group) => {
        const key = `${stream}::${group}`;
        destroyedGroups.push(key);
        groupKeys.delete(key);
      },
    });

    const firstTransport = new RedisStreamsMicroserviceTransport({
      namespace: 'fluo:streams:strict',
      pollBlockMs: 1,
      readerClient: createStrictClient(),
      requestTimeoutMs: 50,
      writerClient: createStrictClient(),
    });

    await firstTransport.listen(async () => undefined);
    await firstTransport.close();

    const secondTransport = new RedisStreamsMicroserviceTransport({
      namespace: 'fluo:streams:strict',
      pollBlockMs: 1,
      readerClient: createStrictClient(),
      requestTimeoutMs: 50,
      writerClient: createStrictClient(),
    });

    await expect(secondTransport.listen(async () => undefined)).resolves.toBeUndefined();
    await secondTransport.close();

    expect(destroyedGroups.some((key) => key === 'fluo:streams:strict:messages::fluo-handlers')).toBe(true);
  });

  it('keeps a shared request consumer group alive while another listener with the same namespace/group stays active', async () => {
    const bus = new InMemoryStreamBus();
    const namespace = 'fluo:streams:shared';
    const consumerGroup = 'shared-handlers';
    const first = createTransport(bus, {
      consumerGroup,
      namespace,
      requestTimeoutMs: 200,
    }).transport;
    const second = createTransport(bus, {
      consumerGroup,
      namespace,
      requestTimeoutMs: 200,
    }).transport;

    await first.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await second.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await first.close();

    await expect(second.send('shared.echo', { ok: true })).resolves.toEqual({ ok: true });

    await second.close();
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
    const logger = { error: vi.fn() };

    transport.setLogger(logger);
    await transport.listen(async () => {
      throw new Error('redis streams event handler failed');
    });

    await expect(transport.emit('audit.login', { message: 'ok' })).resolves.toBeUndefined();
    await sleep(30);

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'redis streams event handler failed' }),
      'RedisStreamsMicroserviceTransport',
    );

    await transport.close();
  });
});
