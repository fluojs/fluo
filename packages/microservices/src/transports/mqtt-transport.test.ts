import { describe, expect, it, vi } from 'vitest';

import { MqttMicroserviceTransport } from './mqtt-transport.js';

interface PublishRecord {
  readonly message: string;
  readonly options: { qos?: number; retain?: boolean };
  readonly topic: string;
}

class InMemoryMqttBroker {
  private readonly subscriptions = new Map<string, Set<InMemoryMqttClient>>();

  subscribe(topic: string, client: InMemoryMqttClient): void {
    const set = this.subscriptions.get(topic) ?? new Set<InMemoryMqttClient>();
    set.add(client);
    this.subscriptions.set(topic, set);
  }

  unsubscribe(topic: string, client: InMemoryMqttClient): void {
    const set = this.subscriptions.get(topic);

    if (!set) {
      return;
    }

    set.delete(client);

    if (set.size === 0) {
      this.subscriptions.delete(topic);
    }
  }

  publish(topic: string, payload: string, packet: { qos?: number; retain?: boolean }): void {
    const subscribers = this.subscriptions.get(topic);

    if (!subscribers) {
      return;
    }

    for (const client of subscribers) {
      client.dispatch(topic, payload, packet);
    }
  }
}

class InMemoryMqttClient {
  readonly published: PublishRecord[] = [];
  endCalled = false;
  failEnd: Error | undefined;
  failPublish: Error | undefined;
  failSubscribeAtCall: number | undefined;
  failUnsubscribe: Error | undefined;
  subscribeCalls = 0;
  unsubscribeCalls = 0;

  private readonly listeners = new Set<(topic: string, payload: Buffer, packet: { qos?: number; retain?: boolean }) => void>();

  constructor(private readonly broker: InMemoryMqttBroker) {}

  on(event: 'message', listener: (topic: string, payload: Buffer, packet: { qos?: number; retain?: boolean }) => void): void {
    if (event === 'message') {
      this.listeners.add(listener);
    }
  }

  off(event: 'message', listener: (topic: string, payload: Buffer, packet: { qos?: number; retain?: boolean }) => void): void {
    if (event === 'message') {
      this.listeners.delete(listener);
    }
  }

  subscribe(topic: string, options: { qos?: number }, callback?: (error?: Error) => void): void {
    void options;
    this.subscribeCalls += 1;

    if (this.failSubscribeAtCall && this.subscribeCalls === this.failSubscribeAtCall) {
      callback?.(new Error('subscribe failed'));
      return;
    }

    this.broker.subscribe(topic, this);
    callback?.();
  }

  unsubscribe(topic: string, callback?: (error?: Error) => void): void {
    this.unsubscribeCalls += 1;

    if (this.failUnsubscribe) {
      callback?.(this.failUnsubscribe);
      return;
    }

    this.broker.unsubscribe(topic, this);
    callback?.();
  }

  publish(topic: string, payload: string, options: { qos?: number; retain?: boolean }, callback?: (error?: Error) => void): void {
    this.published.push({ topic, message: payload, options: { ...options } });

    if (this.failPublish) {
      callback?.(this.failPublish);
      return;
    }

    this.broker.publish(topic, payload, options);
    callback?.();
  }

  end(force?: boolean, callback?: (error?: Error) => void): void {
    void force;
    this.endCalled = true;
    callback?.(this.failEnd);
  }

  dispatch(topic: string, payload: string, packet: { qos?: number; retain?: boolean }): void {
    const buffer = Buffer.from(payload, 'utf8');

    for (const listener of this.listeners) {
      listener(topic, buffer, packet);
    }
  }
}

describe('MqttMicroserviceTransport', () => {
  it('supports request/reply send() and event dispatch', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    const events: string[] = [];
    const transport = new MqttMicroserviceTransport({
      client,
      requestTimeoutMs: 200,
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: string }).value);
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      return input.a + input.b;
    });

    await expect(transport.send('math.sum', { a: 2, b: 5 })).resolves.toBe(7);
    await expect(transport.emit('audit.event', { value: 'ok' })).resolves.toBeUndefined();
    expect(events).toEqual(['ok']);

    await transport.close();
  });

  it('uses per-instance reply topic and configurable qos/retain defaults', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    const transport = new MqttMicroserviceTransport({
      client,
      eventQos: 0,
      eventRetain: false,
      messageQos: 1,
      messageRetain: false,
      requestTimeoutMs: 200,
      responseQos: 1,
      responseRetain: false,
    });

    await transport.listen(async () => 'ok');

    await transport.send('math.sum', { a: 1, b: 2 });
    await transport.emit('audit.event', { value: 'ok' });

    const messagePublish = client.published.find((entry) => JSON.parse(entry.message).kind === 'message');
    const eventPublish = client.published.find((entry) => JSON.parse(entry.message).kind === 'event');
    const responsePublish = client.published.find((entry) => JSON.parse(entry.message).kind === 'response');

    expect((JSON.parse(messagePublish?.message ?? '{}') as { replyTopic?: string }).replyTopic).toMatch(/^fluo\.microservices\.responses\./);
    expect(messagePublish?.options).toEqual({ qos: 1, retain: false });
    expect(eventPublish?.options).toEqual({ qos: 0, retain: false });
    expect(responsePublish?.options).toEqual({ qos: 1, retain: false });

    await transport.close();
  });

  it('rejects send() before listen()', async () => {
    const transport = new MqttMicroserviceTransport({ client: new InMemoryMqttClient(new InMemoryMqttBroker()) });

    await expect(transport.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(
      'MqttMicroserviceTransport is not listening. Call listen() before send().',
    );
  });

  it('rejects pending request on timeout', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({
      client: new InMemoryMqttClient(broker),
      requestTimeoutMs: 30,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    await expect(transport.send('slow.request', { value: 1 })).rejects.toThrow(
      'MQTT request timed out after 30ms waiting for pattern "slow.request".',
    );

    await transport.close();
  });

  it('rejects send() with AbortSignal before publish', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({
      client: new InMemoryMqttClient(broker),
      requestTimeoutMs: 120,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('aborted.before.publish', {}, controller.signal)).rejects.toThrow(
      'MQTT request aborted before publish.',
    );

    await transport.close();
  });

  it('does not publish when AbortSignal fires before deferred dispatch', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    const transport = new MqttMicroserviceTransport({
      client,
      requestTimeoutMs: 120,
    });

    await transport.listen(async () => undefined);

    const controller = new AbortController();
    const pending = transport.send('aborted.deferred', {}, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow('MQTT request aborted.');

    const requestFrames = client.published.filter((entry) => {
      const frame = JSON.parse(entry.message) as { kind?: string };
      return frame.kind === 'message';
    });
    expect(requestFrames).toHaveLength(0);

    await transport.close();
  });

  it('rejects send() with AbortSignal after publish', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({
      client: new InMemoryMqttClient(broker),
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    const controller = new AbortController();
    const pending = transport.send('aborted.inflight', {}, controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toThrow('MQTT request aborted.');

    await transport.close();
  });

  it('supports concurrent request/reply correlation by requestId', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({
      client: new InMemoryMqttClient(broker),
      requestTimeoutMs: 1_000,
    });

    await transport.listen(async (packet) => {
      if (packet.kind !== 'message') {
        return undefined;
      }

      const input = packet.payload as { delayMs: number; value: number };
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      return input.value;
    });

    await expect(Promise.all([
      transport.send('calc.delay', { delayMs: 80, value: 1 }),
      transport.send('calc.delay', { delayMs: 5, value: 2 }),
    ])).resolves.toEqual([1, 2]);

    await transport.close();
  });

  it('rejects pending requests on close()', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({
      client: new InMemoryMqttClient(broker),
      requestTimeoutMs: 5_000,
    });

    await transport.listen(async () => {
      await new Promise<void>(() => undefined);
    });

    const pending = transport.send('slow.close', {});
    await transport.close();

    await expect(pending).rejects.toThrow('MQTT microservice transport closed before response.');
  });

  it('rejects listen() during close() without reopening the shutdown state', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    let releaseUnsubscribe: (() => void) | undefined;
    const unsubscribeGate = new Promise<void>((resolve) => {
      releaseUnsubscribe = resolve;
    });
    const originalUnsubscribe = client.unsubscribe.bind(client);
    client.unsubscribe = (topic, callback) => {
      originalUnsubscribe(topic, (error) => {
        if (error) {
          callback?.(error);
          return;
        }

        void unsubscribeGate.then(() => callback?.());
      });
    };
    const transport = new MqttMicroserviceTransport({ client });

    await transport.listen(async () => undefined);

    const closing = transport.close();

    await expect(transport.listen(async () => undefined)).rejects.toThrow(
      'MqttMicroserviceTransport is closing. Wait for close() to complete before listen().',
    );
    await expect(transport.emit('still.closing', {})).rejects.toThrow(
      'MqttMicroserviceTransport is closing. Wait for close() to complete before emit().',
    );

    releaseUnsubscribe?.();
    await closing;
  });

  it('unsubscribes already-subscribed topics without ending a caller-owned client when a later subscribe fails during listen()', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    client.failSubscribeAtCall = 2;
    const transport = new MqttMicroserviceTransport({ client });

    await expect(transport.listen(async () => undefined)).rejects.toThrow('subscribe failed');
    expect(client).toMatchObject({ endCalled: false, unsubscribeCalls: 1 });
  });

  it('ends internally-created clients when subscribe setup fails during listen()', async () => {
    const broker = new InMemoryMqttBroker();
    const ownedClient = new InMemoryMqttClient(broker);
    ownedClient.failSubscribeAtCall = 2;
    const transport = new MqttMicroserviceTransport({
      mqtt: {
        connect() {
          return ownedClient;
        },
      },
      url: 'mqtt://localhost:1883',
    });

    await expect(transport.listen(async () => undefined)).rejects.toThrow('subscribe failed');

    expect(ownedClient.unsubscribeCalls).toBe(1);
    expect(ownedClient.endCalled).toBe(true);
  });

  it('preserves listen errors while close() unwinds internally-created clients', async () => {
    const broker = new InMemoryMqttBroker();
    const ownedClient = new InMemoryMqttClient(broker);
    let releaseSubscribeFailure: (() => void) | undefined;
    const subscribeFailureGate = new Promise<void>((resolve) => {
      releaseSubscribeFailure = resolve;
    });
    const originalSubscribe = ownedClient.subscribe.bind(ownedClient);

    ownedClient.subscribe = (topic, options, callback) => {
      if (ownedClient.subscribeCalls === 0) {
        originalSubscribe(topic, options, callback);
        return;
      }

      ownedClient.subscribeCalls += 1;
      void subscribeFailureGate.then(() => callback?.(new Error('subscribe failed')));
    };
    const transport = new MqttMicroserviceTransport({
      mqtt: {
        connect() {
          return ownedClient;
        },
      },
      url: 'mqtt://localhost:1883',
    });

    const listening = transport.listen(async () => undefined);
    await waitForCondition(() => ownedClient.subscribeCalls === 2);

    const closing = transport.close();
    releaseSubscribeFailure?.();

    await expect(listening).rejects.toThrow('subscribe failed');
    await expect(closing).rejects.toThrow('subscribe failed');
    expect(ownedClient.unsubscribeCalls).toBe(1);
    expect(ownedClient.endCalled).toBe(true);
  });

  it('supports reconnect/listen re-entry after close()', async () => {
    const broker = new InMemoryMqttBroker();
    const client = new InMemoryMqttClient(broker);
    const transport = new MqttMicroserviceTransport({ client, requestTimeoutMs: 200 });

    await transport.listen(async () => 'first');
    await expect(transport.send('health.ping', {})).resolves.toBe('first');

    await transport.close();

    await transport.listen(async () => 'second');
    await expect(transport.send('health.ping', {})).resolves.toBe('second');
    await transport.close();
  });

  it('routes event handler failures through the injected logger without rejecting emit()', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({ client: new InMemoryMqttClient(broker) });
    const logger = { error: vi.fn() };

    transport.setLogger(logger);
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('mqtt event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.event', { value: 'bad' })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'mqtt event failed' }),
      'MqttMicroserviceTransport',
    );

    await transport.close();
  });

  it('does not fall back to console.error when no logger is configured', async () => {
    const broker = new InMemoryMqttBroker();
    const transport = new MqttMicroserviceTransport({ client: new InMemoryMqttClient(broker) });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('mqtt event failed without logger');
      }

      return undefined;
    });

    await expect(transport.emit('audit.event', { value: 'bad' })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).not.toHaveBeenCalled();

    await transport.close();
  });

  it('ends internally-created client on close()', async () => {
    const broker = new InMemoryMqttBroker();
    const ownedClient = new InMemoryMqttClient(broker);
    const transport = new MqttMicroserviceTransport({
      mqtt: {
        connect() {
          return ownedClient;
        },
      },
      url: 'mqtt://localhost:1883',
    });

    await transport.listen(async () => undefined);
    await transport.close();

    expect(ownedClient.endCalled).toBe(true);
  });

  it('does not end externally-provided client on close()', async () => {
    const broker = new InMemoryMqttBroker();
    const sharedClient = new InMemoryMqttClient(broker);
    const transport = new MqttMicroserviceTransport({ client: sharedClient });

    await transport.listen(async () => undefined);
    await transport.close();

    expect(sharedClient.endCalled).toBe(false);
  });

  it('loads optional mqtt peer lazily and reports missing peer clearly', async () => {
    const transport = new MqttMicroserviceTransport({
      moduleLoader: async () => {
        throw new Error('module not found');
      },
      url: 'mqtt://localhost:1883',
    });

    await expect(transport.listen(async () => undefined)).rejects.toThrow(
      'Missing optional peer dependency "mqtt" required by MqttMicroserviceTransport',
    );
  });
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for MQTT test condition.');
}
