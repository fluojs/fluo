import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisPubSubMicroserviceTransport } from './redis-transport.js';

type MessageListener = (channel: string, message: string) => void;

class FrameInjectingRedisBus {
  unsubscribeCalled = false;
  private readonly listeners = new Set<MessageListener>();
  private subscribed = false;

  readonly publishClient = {
    on: () => undefined,
    publish: async () => undefined,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
  };

  readonly subscribeClient = {
    on: (event: 'message', listener: MessageListener) => {
      if (event === 'message') {
        this.listeners.add(listener);
      }
    },
    off: (event: 'message', listener: MessageListener) => {
      if (event === 'message') {
        this.listeners.delete(listener);
      }
    },
    publish: async () => undefined,
    subscribe: async () => {
      this.subscribed = true;
    },
    unsubscribe: async () => {
      this.unsubscribeCalled = true;
      this.subscribed = false;
    },
  };

  deliver(channel: string, rawMessage: string): void {
    if (!this.subscribed) {
      return;
    }

    if (this.listeners.size === 0) {
      throw new Error('Expected a Redis message listener to be registered.');
    }

    for (const listener of this.listeners) {
      listener(channel, rawMessage);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }
}

const eventChannel = 'fluo:microservices:events';

describe('RedisPubSubMicroserviceTransport malformed frame containment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains unparsable frames and reports the decode failure through the transport logger', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    bus.deliver(eventChannel, '{not-json');

    // Then
    expect(logger.error).toHaveBeenCalledWith(
      'Malformed frame discarded.',
      expect.any(Error),
      'RedisPubSubMicroserviceTransport',
    );
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(1);

    await transport.close();
  });

  it.each([
    ['null frame', 'null'],
    ['scalar frame', '42'],
    ['array frame', '[]'],
    ['string frame', '"event"'],
  ])('contains non-object %s payloads without dispatching to the runtime handler', async (_label, rawMessage) => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    bus.deliver(eventChannel, rawMessage);

    // Then
    expect(logger.error).toHaveBeenCalledWith(
      'Malformed frame discarded.',
      expect.any(Error),
      'RedisPubSubMicroserviceTransport',
    );
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(1);

    await transport.close();
  });

  it.each([
    ['missing pattern', { kind: 'event' }],
    ['non-string pattern', { kind: 'event', pattern: { nested: true } }],
    ['null pattern', { kind: 'event', pattern: null }],
    ['numeric pattern', { kind: 'event', pattern: 7 }],
  ])('rejects event frames with a %s instead of forwarding an invalid TransportPacket', async (_label, frame) => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    bus.deliver(eventChannel, JSON.stringify(frame));

    // Then
    expect(logger.error).toHaveBeenCalledWith(
      'Malformed frame discarded.',
      expect.any(Error),
      'RedisPubSubMicroserviceTransport',
    );
    expect(handler).not.toHaveBeenCalled();

    await transport.close();
  });

  it('discards unknown frame kinds and reports them as malformed', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    bus.deliver(eventChannel, JSON.stringify({ kind: 'response', pattern: 'math.sum', payload: 3 }));

    // Then
    expect(logger.error).toHaveBeenCalledWith(
      'Malformed frame discarded.',
      expect.any(Error),
      'RedisPubSubMicroserviceTransport',
    );
    expect(handler).not.toHaveBeenCalled();

    await transport.close();
  });

  it('keeps dispatching valid frames after a malformed frame is contained', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const received: unknown[] = [];
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(async (packet) => {
      received.push(packet);
      return undefined;
    });

    // When
    bus.deliver(eventChannel, '{not-json');
    bus.deliver(eventChannel, JSON.stringify({ kind: 'event', pattern: 'audit.value', payload: { value: 9 } }));

    // Then
    expect(received).toEqual([{ kind: 'event', pattern: 'audit.value', payload: { value: 9 } }]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(bus.unsubscribeCalled).toBe(false);
    expect(bus.isSubscribed()).toBe(true);

    await transport.close();
  });

  it('contains malformed frames without a transport logger and without a console.error fallback', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    await transport.listen(handler);

    // When
    bus.deliver(eventChannel, '{not-json');
    bus.deliver(eventChannel, 'null');
    // Then
    expect(consoleError).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(1);

    await transport.close();
  });

  it('contains logger-throw regressions when the malformed-frame boundary reports a decode failure', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const loggerError = new Error('logger sink unavailable');
    const logger = {
      error: vi.fn(() => {
        throw loggerError;
      }),
    };
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    expect(() => bus.deliver(eventChannel, '{not-json')).not.toThrow();

    // Then
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(1);

    await transport.close();
  });

  it('ignores frames delivered on a channel outside the configured namespace', async () => {
    // Given
    const bus = new FrameInjectingRedisBus();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new RedisPubSubMicroserviceTransport({
      namespace: 'test-ns',
      publishClient: bus.publishClient,
      subscribeClient: bus.subscribeClient,
    });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    bus.deliver('other-ns:events', '{not-json');
    // Then
    expect(logger.error).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    await transport.close();
  });
});
