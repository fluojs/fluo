import { describe, expect, it, vi } from 'vitest';

import {
  type RedisStreamClientLike,
  RedisStreamsMicroserviceTransport,
  type RedisStreamsMicroserviceTransportOptions,
  type RedisStreamWriteOptions,
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

  countStreamEntries(stream: string): number {
    return (this.streams.get(stream) ?? []).filter((entry) => !entry.deleted).length;
  }

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

interface PendingEntryRecord {
  consumer: string;
  readonly deliveredAtMs: number;
  readonly id: string;
}

/**
 * Stream client double that tracks a per-group Pending Entries List so abandoned-entry
 * recovery can be asserted without a live Redis server.
 */
class PendingEntriesListBus implements RedisStreamClientLike {
  private autoClaimCalls = 0;
  private readonly claimedConsumers: string[] = [];
  private readonly drainedWaiters = new Map<string, Set<() => void>>();
  private readonly groups = new Map<string, Map<string, PendingEntryRecord>>();
  private readonly readGroupKeys = new Set<string>();
  private readonly readWaiters = new Map<string, Set<() => void>>();
  private readonly readPositions = new Map<string, number>();
  private nextSequence = 0;
  private readonly streams = new Map<string, InMemoryStreamEntry[]>();

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const entries = this.streams.get(stream) ?? [];
    this.nextSequence += 1;
    const id = `0-${String(this.nextSequence)}`;
    entries.push({ id, fields: { ...fields } });
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
      const groupKey = `${stream}::${group}`;
      const pending = this.groups.get(groupKey);

      if (!pending) {
        throw new Error(`NOGROUP ${groupKey}`);
      }

      this.readGroupKeys.add(groupKey);
      this.resolveWaiters(this.readWaiters, groupKey);

      const entries = this.streams.get(stream) ?? [];
      let position = this.readPositions.get(groupKey) ?? 0;

      while (position < entries.length && results.length < count) {
        const entry = entries[position];
        position += 1;

        if (!entry) {
          continue;
        }

        pending.set(entry.id, { consumer, deliveredAtMs: Date.now(), id: entry.id });
        results.push({ id: entry.id, fields: { ...entry.fields } });
      }

      this.readPositions.set(groupKey, position);
    }

    return results.length > 0 ? results : null;
  }

  async xautoclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleTimeMs: number,
    startId: string,
    options?: { count?: number },
  ): Promise<{ readonly entries: readonly InMemoryStreamEntry[]; readonly nextStartId: string }> {
    this.autoClaimCalls += 1;

    const groupKey = `${stream}::${group}`;
    const pending = this.groups.get(groupKey);

    if (!pending) {
      throw new Error(`NOGROUP ${groupKey}`);
    }

    const count = options?.count ?? 10;
    const entries = this.streams.get(stream) ?? [];
    const claimed: InMemoryStreamEntry[] = [];
    const now = Date.now();
    const startSequence = Number.parseInt(startId.split('-')[1] ?? '0', 10);
    let nextStartId = '0-0';

    for (const record of [...pending.values()].sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))) {
      if (claimed.length >= count) {
        nextStartId = record.id;
        break;
      }

      if (Number.parseInt(record.id.split('-')[1] ?? '0', 10) < startSequence) {
        continue;
      }

      if (now - record.deliveredAtMs < minIdleTimeMs) {
        continue;
      }

      this.claimedConsumers.push(record.consumer);
      record.consumer = consumer;

      const entry = entries.find((candidate) => candidate.id === record.id);

      if (entry) {
        claimed.push({ id: entry.id, fields: { ...entry.fields } });
      }
    }

    return { entries: claimed, nextStartId };
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    const groupKey = `${stream}::${group}`;
    const pending = this.groups.get(groupKey);

    pending?.delete(id);

    if (pending?.size === 0) {
      this.resolveWaiters(this.drainedWaiters, groupKey);
    }
  }

  async xdel(stream: string, id: string): Promise<void> {
    const entries = this.streams.get(stream);

    if (!entries) {
      return;
    }

    const index = entries.findIndex((entry) => entry.id === id);

    if (index >= 0) {
      entries.splice(index, 1);
    }
  }

  async del(stream: string): Promise<void> {
    this.streams.delete(stream);
  }

  async xgroupCreate(stream: string, group: string, startId: string, mkstream: boolean): Promise<void> {
    if (!this.streams.has(stream)) {
      if (!mkstream) {
        throw new Error(`NOSTREAM ${stream}`);
      }

      this.streams.set(stream, []);
    }

    const groupKey = `${stream}::${group}`;

    if (this.groups.has(groupKey)) {
      throw new Error(`BUSYGROUP Consumer Group name already exists for ${groupKey}`);
    }

    this.groups.set(groupKey, new Map<string, PendingEntryRecord>());
    this.readPositions.set(groupKey, startId === '$' ? (this.streams.get(stream) ?? []).length : 0);
  }

  async xgroupDestroy(stream: string, group: string): Promise<void> {
    const groupKey = `${stream}::${group}`;
    this.groups.delete(groupKey);
    this.readPositions.delete(groupKey);
  }

  /** Marks one entry as delivered to `consumer` without acknowledgement, simulating a crash. */
  async deliverTo(stream: string, group: string, consumer: string, id: string): Promise<void> {
    const pending = this.groups.get(`${stream}::${group}`);

    if (!pending) {
      throw new Error(`NOGROUP ${stream}::${group}`);
    }

    pending.set(id, { consumer, deliveredAtMs: 0, id });

    const entries = this.streams.get(stream) ?? [];
    const index = entries.findIndex((entry) => entry.id === id);
    this.readPositions.set(`${stream}::${group}`, index >= 0 ? index + 1 : entries.length);
  }

  pendingIds(stream: string, group: string): readonly string[] {
    return [...(this.groups.get(`${stream}::${group}`)?.keys() ?? [])];
  }

  claimedByConsumers(): readonly string[] {
    return [...this.claimedConsumers];
  }

  autoClaimCallCount(): number {
    return this.autoClaimCalls;
  }

  /** Resolves when the group's Pending Entries List transitions to empty. */
  async waitForPendingDrain(stream: string, group: string, timeoutMs = 2_000): Promise<void> {
    const groupKey = `${stream}::${group}`;

    if (this.pendingIds(stream, group).length === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiters = this.drainedWaiters.get(groupKey) ?? new Set<() => void>();
      this.drainedWaiters.set(groupKey, waiters);

      const onDrain = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        waiters.delete(onDrain);

        if (waiters.size === 0) {
          this.drainedWaiters.delete(groupKey);
        }

        reject(new Error(`Pending entries for ${groupKey} were not reclaimed within ${String(timeoutMs)}ms.`));
      }, timeoutMs);

      waiters.add(onDrain);
    });
  }

  /** Resolves once the transport has attempted a group read. */
  async waitForGroupRead(stream: string, group: string, timeoutMs = 2_000): Promise<void> {
    const groupKey = `${stream}::${group}`;

    if (this.readGroupKeys.has(groupKey)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiters = this.readWaiters.get(groupKey) ?? new Set<() => void>();
      this.readWaiters.set(groupKey, waiters);

      const onRead = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        waiters.delete(onRead);

        if (waiters.size === 0) {
          this.readWaiters.delete(groupKey);
        }

        reject(new Error(`No Redis group read occurred for ${groupKey} within ${String(timeoutMs)}ms.`));
      }, timeoutMs);

      waiters.add(onRead);
    });
  }

  private resolveWaiters(waitersByGroup: Map<string, Set<() => void>>, groupKey: string): void {
    const waiters = waitersByGroup.get(groupKey);

    if (!waiters) {
      return;
    }

    waitersByGroup.delete(groupKey);

    for (const resolve of waiters) {
      resolve();
    }
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

function createLeaseAwareClient(
  bus: InMemoryStreamBus,
  values: Map<string, string>,
  destroyedGroups: string[] = [],
): RedisStreamClientLike {
  return {
    xadd: async (stream, fields, options) => {
      return await bus.xadd(stream, fields, options);
    },
    xreadgroup: async (group, consumer, streams, options) => {
      return await bus.xreadgroup(group, consumer, streams, options);
    },
    xack: async (stream, group, id) => {
      await bus.xack(stream, group, id);
    },
    get: async (key) => values.get(key) ?? null,
    incr: async (key) => {
      const nextValue = Number.parseInt(values.get(key) ?? '0', 10) + 1;
      values.set(key, String(nextValue));
      return nextValue;
    },
    decr: async (key) => {
      const nextValue = Number.parseInt(values.get(key) ?? '0', 10) - 1;
      values.set(key, String(nextValue));
      return nextValue;
    },
    set: async (key, value) => {
      values.set(key, value);
      return 'OK';
    },
    xdel: async (stream, id) => {
      await bus.xdel(stream, id);
    },
    del: async (key) => {
      values.delete(key);
      await bus.del(key);
    },
    xgroupCreate: async (stream, group, startId, mkstream) => {
      await bus.xgroupCreate(stream, group, startId, mkstream);
    },
    xgroupDestroy: async (stream, group) => {
      destroyedGroups.push(`${stream}::${group}`);
      await bus.xgroupDestroy(stream, group);
    },
  } satisfies RedisStreamClientLike;
}

function createFallbackClient(bus: InMemoryStreamBus, destroyedGroups: string[] = []): RedisStreamClientLike {
  return {
    xadd: async (stream, fields, options) => {
      return await bus.xadd(stream, fields, options);
    },
    xreadgroup: async (group, consumer, streams, options) => {
      return await bus.xreadgroup(group, consumer, streams, options);
    },
    xack: async (stream, group, id) => {
      await bus.xack(stream, group, id);
    },
    del: async (stream) => {
      await bus.del(stream);
    },
    xdel: async (stream, id) => {
      await bus.xdel(stream, id);
    },
    xgroupCreate: async (stream, group, startId, mkstream) => {
      await bus.xgroupCreate(stream, group, startId, mkstream);
    },
    xgroupDestroy: async (stream, group) => {
      destroyedGroups.push(`${stream}::${group}`);
      await bus.xgroupDestroy(stream, group);
    },
  } satisfies RedisStreamClientLike;
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

  it('keeps the shared request consumer group intact on close so repeated listen/close cycles still tolerate BUSYGROUP state', async () => {
    const bus = new InMemoryStreamBus();
    const destroyedGroups: string[] = [];
    const values = new Map<string, string>();

    const firstTransport = new RedisStreamsMicroserviceTransport({
      namespace: 'fluo:streams:strict',
      pollBlockMs: 1,
      readerClient: createLeaseAwareClient(bus, values, destroyedGroups),
      requestTimeoutMs: 50,
      writerClient: createLeaseAwareClient(bus, values, destroyedGroups),
    });

    await firstTransport.listen(async () => undefined);
    await firstTransport.close();

    const secondTransport = new RedisStreamsMicroserviceTransport({
      namespace: 'fluo:streams:strict',
      pollBlockMs: 1,
      readerClient: createLeaseAwareClient(bus, values, destroyedGroups),
      requestTimeoutMs: 50,
      writerClient: createLeaseAwareClient(bus, values, destroyedGroups),
    });

    await expect(secondTransport.listen(async () => undefined)).resolves.toBeUndefined();
    await secondTransport.close();

    expect(destroyedGroups).not.toContain('fluo:streams:strict:messages::fluo-handlers');
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

  it('keeps the shared request consumer group alive on fallback clients without optional lease helpers', async () => {
    const bus = new InMemoryStreamBus();
    const namespace = 'fluo:streams:no-lease';
    const consumerGroup = 'shared-handlers';
    const destroyedGroups: string[] = [];
    const first = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });
    const second = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });

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

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);
    await expect(second.send('shared.echo', { ok: true })).resolves.toEqual({ ok: true });

    await second.close();

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);

    const third = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });

    await expect(third.listen(async () => undefined)).resolves.toBeUndefined();
    await third.close();

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);
  });

  it('retains the shared request consumer group when a lease-capable listener closes before a fallback peer', async () => {
    const bus = new InMemoryStreamBus();
    const values = new Map<string, string>();
    const destroyedGroups: string[] = [];
    const namespace = 'fluo:streams:mixed-close-lease-first';
    const consumerGroup = 'shared-handlers';

    const leaseCapable = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createLeaseAwareClient(bus, values, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createLeaseAwareClient(bus, values, destroyedGroups),
    });
    const fallback = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });

    await leaseCapable.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await fallback.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await leaseCapable.close();

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);

    await fallback.close();
  });

  it('retains the shared request consumer group when a fallback listener closes before a lease-capable peer', async () => {
    const bus = new InMemoryStreamBus();
    const values = new Map<string, string>();
    const destroyedGroups: string[] = [];
    const namespace = 'fluo:streams:mixed-close-fallback-first';
    const consumerGroup = 'shared-handlers';

    const leaseCapable = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createLeaseAwareClient(bus, values, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createLeaseAwareClient(bus, values, destroyedGroups),
    });
    const fallback = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });

    await leaseCapable.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await fallback.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await fallback.close();

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);

    await leaseCapable.close();
  });

  it('lets the surviving mixed-fleet peer continue send()/receive traffic after the other listener closes', async () => {
    const bus = new InMemoryStreamBus();
    const values = new Map<string, string>();
    const destroyedGroups: string[] = [];
    const namespace = 'fluo:streams:mixed-survivor';
    const consumerGroup = 'shared-handlers';

    const leaseCapable = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createLeaseAwareClient(bus, values, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createLeaseAwareClient(bus, values, destroyedGroups),
    });
    const fallback = new RedisStreamsMicroserviceTransport({
      consumerGroup,
      namespace,
      pollBlockMs: 1,
      readerClient: createFallbackClient(bus, destroyedGroups),
      requestTimeoutMs: 200,
      writerClient: createFallbackClient(bus, destroyedGroups),
    });
    const receivedEvents: string[] = [];

    await leaseCapable.listen(async (packet) => {
      if (packet.kind === 'event') {
        receivedEvents.push(String((packet.payload as { from: string }).from));
        return undefined;
      }

      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await fallback.listen(async (packet) => {
      if (packet.kind === 'event') {
        receivedEvents.push(String((packet.payload as { from: string }).from));
        return undefined;
      }

      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await leaseCapable.close();

    await expect(fallback.send('mixed.echo', { ok: true })).resolves.toEqual({ ok: true });
    await fallback.emit('mixed.event', { from: 'fallback' });
    await sleep(20);

    expect(destroyedGroups).not.toContain(`${namespace}:messages::${consumerGroup}`);
    expect(receivedEvents).toContain('fallback');

    await fallback.close();
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

  it('does not publish when AbortSignal fires before deferred dispatch', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      namespace: 'fluo:test:abort-deferred',
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    const pending = transport.send('aborted.deferred', {}, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow('Redis Streams request aborted.');
    expect(bus.countStreamEntries('fluo:test:abort-deferred:messages')).toBe(0);

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

  it('rejects emit() after close() starts', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async () => undefined);
    await transport.close();

    await expect(transport.emit('after.close', {})).rejects.toThrow(
      'RedisStreamsMicroserviceTransport is closing. Wait for close() to complete before emit().',
    );
  });

  it('rejects emit() without xadd while close() is still draining', async () => {
    const bus = new InMemoryStreamBus();
    let releaseDestroy: (() => void) | undefined;
    let resolveDestroyStarted: (() => void) | undefined;
    let destroyBlocked = false;
    const destroyStarted = new Promise<void>((resolve) => {
      resolveDestroyStarted = resolve;
    });
    const readerClient = {
      xadd: async (stream, fields, options) => {
        return await bus.xadd(stream, fields, options);
      },
      xreadgroup: async (group, consumer, streams, options) => {
        return await bus.xreadgroup(group, consumer, streams, options);
      },
      xack: async (stream, group, id) => {
        await bus.xack(stream, group, id);
      },
      xdel: async (stream, id) => {
        await bus.xdel(stream, id);
      },
      del: async (stream) => {
        await bus.del(stream);
      },
      xgroupCreate: async (stream, group, startId, mkstream) => {
        await bus.xgroupCreate(stream, group, startId, mkstream);
      },
      xgroupDestroy: async (stream, group) => {
        if (!destroyBlocked) {
          destroyBlocked = true;
          resolveDestroyStarted?.();
          await new Promise<void>((release) => {
            releaseDestroy = release;
          });
        }

        await bus.xgroupDestroy(stream, group);
      },
    } satisfies RedisStreamClientLike;
    const xadd = vi.fn(async (stream: string, fields: Record<string, string>, options?: RedisStreamWriteOptions) => {
      return await bus.xadd(stream, fields, options);
    });
    const transport = new RedisStreamsMicroserviceTransport({
      pollBlockMs: 1,
      readerClient,
      requestTimeoutMs: 1_000,
      writerClient: {
        xadd,
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

    await transport.listen(async () => undefined);

    const closing = transport.close();
    await destroyStarted;

    await expect(transport.listen(async () => undefined)).rejects.toThrow(
      'RedisStreamsMicroserviceTransport is closing. Wait for close() to complete before listen().',
    );
    await expect(transport.emit('during.close', {})).rejects.toThrow(
      'RedisStreamsMicroserviceTransport is closing. Wait for close() to complete before emit().',
    );
    expect(xadd).not.toHaveBeenCalled();

    releaseDestroy?.();
    await closing;
  });

  it('cleans up stream resources before rethrowing a failed in-flight listen during close()', async () => {
    const bus = new InMemoryStreamBus();
    const namespace = 'fluo:streams:listen-close-failure';
    const startupError = new Error('response group failed');
    const values = new Map<string, string>();
    const destroyedGroups: string[] = [];
    const deletedKeys: string[] = [];
    let releaseResponseCreate: (() => void) | undefined;
    let resolveResponseCreateStarted: (() => void) | undefined;
    const responseCreateStarted = new Promise<void>((resolve) => {
      resolveResponseCreateStarted = resolve;
    });
    const leaseAwareClient = createLeaseAwareClient(bus, values, destroyedGroups);
    const readerClient = {
      ...leaseAwareClient,
      del: async (key: string) => {
        deletedKeys.push(key);

        if (leaseAwareClient.del) {
          await leaseAwareClient.del(key);
        }
      },
      xgroupCreate: async (stream: string, group: string, startId: string, mkstream: boolean) => {
        if (stream.startsWith(`${namespace}:responses:`)) {
          resolveResponseCreateStarted?.();
          await new Promise<void>((resolve) => {
            releaseResponseCreate = resolve;
          });
          throw startupError;
        }

        await leaseAwareClient.xgroupCreate(stream, group, startId, mkstream);
      },
    } satisfies RedisStreamClientLike;
    const { transport } = createTransport(bus, {
      namespace,
      readerClient,
    });

    const listening = transport.listen(async () => undefined);
    const listenResult = listening.catch((error: unknown) => error);
    await responseCreateStarted;

    const closing = transport.close();
    releaseResponseCreate?.();

    await expect(closing).rejects.toBe(startupError);
    await expect(listenResult).resolves.toBe(startupError);
    expect(values.get(`${namespace}:groups:fluo-handlers:owner`)).toBeUndefined();
    expect(values.get(`${namespace}:groups:fluo-handlers:listeners`)).toBeUndefined();
    expect(destroyedGroups.some((entry) => entry.startsWith(`${namespace}:events::fluo-handlers:events:`))).toBe(true);
    expect(
      destroyedGroups.some((entry) => (
        entry.startsWith(`${namespace}:responses:`) && entry.includes('::fluo-handlers:responses:')
      )),
    ).toBe(true);
    expect(deletedKeys.some((key) => key.startsWith(`${namespace}:responses:`))).toBe(true);
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

  it('does not fall back to console.error when no logger is configured', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      requestTimeoutMs: 1_000,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await transport.listen(async () => {
      throw new Error('redis streams event handler failed without logger');
    });

    await expect(transport.emit('audit.login', { message: 'ok' })).resolves.toBeUndefined();
    await sleep(30);

    expect(consoleError).not.toHaveBeenCalled();

    await transport.close();
  });

  it('reclaims request entries abandoned by a crashed consumer of the shared request group by default', async () => {
    const pel = new PendingEntriesListBus();
    const abandonedId = await pel.xadd('fluo:streams:messages', {
      kind: 'message',
      pattern: 'payment.capture',
      payload: JSON.stringify({ orderId: 'order-1' }),
      replyStream: 'fluo:streams:responses:crashed-consumer',
      requestId: 'request-1',
    });

    await pel.xgroupCreate('fluo:streams:messages', 'payments', '0', true);
    await pel.deliverTo('fluo:streams:messages', 'payments', 'crashed-consumer', abandonedId);

    expect(pel.pendingIds('fluo:streams:messages', 'payments')).toEqual([abandonedId]);

    const patterns: string[] = [];
    const transport = new RedisStreamsMicroserviceTransport({
      consumerGroup: 'payments',
      pollBlockMs: 1,
      readerClient: pel,
      requestTimeoutMs: 1_000,
      writerClient: pel,
    });

    await transport.listen(async (packet) => {
      patterns.push(packet.pattern);
      return 'captured';
    });

    await pel.waitForPendingDrain('fluo:streams:messages', 'payments');

    expect(patterns).toContain('payment.capture');
    expect(pel.claimedByConsumers()).toContain('crashed-consumer');

    await transport.close();
  });

  it('follows the XAUTOCLAIM cursor until every abandoned request entry is acknowledged', async () => {
    const pel = new PendingEntriesListBus();
    await pel.xgroupCreate('fluo:streams:messages', 'payments', '0', true);

    const expectedPatterns = Array.from({ length: 11 }, (_, index) => `payment.capture.${String(index + 1)}`);

    for (const [index, pattern] of expectedPatterns.entries()) {
      const id = await pel.xadd('fluo:streams:messages', {
        kind: 'message',
        pattern,
        payload: JSON.stringify({ orderId: `order-${String(index + 1)}` }),
        replyStream: 'fluo:streams:responses:crashed-consumer',
        requestId: `request-${String(index + 1)}`,
      });

      await pel.deliverTo('fluo:streams:messages', 'payments', 'crashed-consumer', id);
    }

    const receivedPatterns: string[] = [];
    const transport = new RedisStreamsMicroserviceTransport({
      consumerGroup: 'payments',
      pendingReclaimIdleMs: 1,
      pollBlockMs: 1,
      readerClient: pel,
      requestTimeoutMs: 1_000,
      writerClient: pel,
    });

    await transport.listen(async (packet) => {
      receivedPatterns.push(packet.pattern);
      return 'captured';
    });

    await pel.waitForPendingDrain('fluo:streams:messages', 'payments');

    expect(receivedPatterns).toEqual(expectedPatterns);
    expect(pel.autoClaimCallCount()).toBeGreaterThanOrEqual(2);

    await transport.close();
  });

  it('skips pending reclaim when the client does not implement xautoclaim', async () => {
    const bus = new InMemoryStreamBus();
    const { transport } = createTransport(bus, {
      consumerGroup: 'payments',
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await expect(transport.send('audit.message', { value: 1 })).resolves.toEqual({ value: 1 });

    await transport.close();
  });

  it('continues consuming requests when xautoclaim rejects', async () => {
    const bus = new InMemoryStreamBus();
    const operationTrace: string[] = [];
    const readerClient = {
      xadd: async (stream: string, fields: Record<string, string>, options?: RedisStreamWriteOptions) => {
        return await bus.xadd(stream, fields, options);
      },
      xreadgroup: async (group: string, consumer: string, streams: readonly string[], options?: { blockMs?: number; count?: number }) => {
        if (streams.includes('fluo:streams:messages')) {
          operationTrace.push('xreadgroup:messages');
        }

        return await bus.xreadgroup(group, consumer, streams, options);
      },
      xautoclaim: async (stream: string) => {
        if (stream === 'fluo:streams:messages') {
          operationTrace.push('xautoclaim:messages');
        }

        throw new Error('NOPERM this user has no permissions to run the xautoclaim command');
      },
      xack: async (stream: string, group: string, id: string) => {
        await bus.xack(stream, group, id);
      },
      xdel: async (stream: string, id: string) => {
        await bus.xdel(stream, id);
      },
      xgroupCreate: async (stream: string, group: string, startId: string, mkstream: boolean) => {
        await bus.xgroupCreate(stream, group, startId, mkstream);
      },
      xgroupDestroy: async (stream: string, group: string) => {
        await bus.xgroupDestroy(stream, group);
      },
    } satisfies RedisStreamClientLike;
    const transport = new RedisStreamsMicroserviceTransport({
      pollBlockMs: 1,
      readerClient,
      requestTimeoutMs: 100,
      writerClient: bus,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        return packet.payload;
      }

      return undefined;
    });

    await expect(transport.send('reclaim.rejected', { accepted: true })).resolves.toEqual({ accepted: true });
    expect(operationTrace).toContain('xautoclaim:messages');
    expect(operationTrace.indexOf('xautoclaim:messages')).toBeLessThan(operationTrace.indexOf('xreadgroup:messages'));

    await transport.close();
  });

  it('disables pending reclaim when pendingReclaimIdleMs is not positive', async () => {
    const pel = new PendingEntriesListBus();
    const abandonedId = await pel.xadd('fluo:streams:messages', {
      kind: 'message',
      pattern: 'payment.capture',
      payload: JSON.stringify({ orderId: 'order-1' }),
      requestId: 'request-1',
    });

    await pel.xgroupCreate('fluo:streams:messages', 'payments', '0', true);
    await pel.deliverTo('fluo:streams:messages', 'payments', 'crashed-consumer', abandonedId);

    const transport = new RedisStreamsMicroserviceTransport({
      consumerGroup: 'payments',
      pendingReclaimIdleMs: 0,
      pollBlockMs: 1,
      readerClient: pel,
      requestTimeoutMs: 1_000,
      writerClient: pel,
    });

    await transport.listen(async () => 'captured');
    await pel.waitForGroupRead('fluo:streams:messages', 'payments');

    expect(pel.pendingIds('fluo:streams:messages', 'payments')).toEqual([abandonedId]);
    expect(pel.autoClaimCallCount()).toBe(0);

    await transport.close();
  });
});
