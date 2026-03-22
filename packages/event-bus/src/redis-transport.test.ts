import { describe, expect, it, vi } from 'vitest';

import { RedisEventBusTransport } from './redis-transport.js';

class MockRedisClient {
  readonly messageListeners: Array<(channel: string, message: string) => void> = [];
  readonly publishes: Array<{ channel: string; message: string }> = [];
  readonly subscribedChannels: string[] = [];
  disconnectCalls = 0;

  on(event: string, listener: (channel: string, message: string) => void): this {
    if (event === 'message') {
      this.messageListeners.push(listener);
    }

    return this;
  }

  async publish(channel: string, message: string): Promise<number> {
    this.publishes.push({ channel, message });
    return 1;
  }

  async subscribe(channel: string): Promise<void> {
    this.subscribedChannels.push(channel);
  }

  emitMessage(channel: string, payload: string): void {
    for (const listener of this.messageListeners) {
      listener(channel, payload);
    }
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

describe('RedisEventBusTransport', () => {
  it('attaches a single message listener and dispatches by channel', async () => {
    const publishClient = new MockRedisClient();
    const subscribeClient = new MockRedisClient();
    const transport = new RedisEventBusTransport({
      publishClient: publishClient as never,
      subscribeClient: subscribeClient as never,
    });
    const onUserCreated = vi.fn(async (_payload: unknown) => undefined);
    const onPasswordReset = vi.fn(async (_payload: unknown) => undefined);

    await transport.subscribe('UserCreatedEvent', onUserCreated);
    await transport.subscribe('PasswordResetEvent', onPasswordReset);

    expect(subscribeClient.subscribedChannels).toEqual(['UserCreatedEvent', 'PasswordResetEvent']);
    expect(subscribeClient.messageListeners).toHaveLength(1);

    subscribeClient.emitMessage('UserCreatedEvent', JSON.stringify({ userId: 'u1' }));
    subscribeClient.emitMessage('PasswordResetEvent', JSON.stringify({ userId: 'u2' }));
    subscribeClient.emitMessage('UnknownEvent', JSON.stringify({ ignored: true }));

    expect(onUserCreated).toHaveBeenCalledTimes(1);
    expect(onUserCreated).toHaveBeenCalledWith({ userId: 'u1' });
    expect(onPasswordReset).toHaveBeenCalledTimes(1);
    expect(onPasswordReset).toHaveBeenCalledWith({ userId: 'u2' });
  });

  it('ignores invalid JSON payloads', async () => {
    const transport = new RedisEventBusTransport({
      publishClient: new MockRedisClient() as never,
      subscribeClient: new MockRedisClient() as never,
    });
    const handler = vi.fn(async (_payload: unknown) => undefined);
    const subscribeClient = (transport as unknown as { subscribeClient: MockRedisClient }).subscribeClient;

    await transport.subscribe('InvalidJsonEvent', handler);
    subscribeClient.emitMessage('InvalidJsonEvent', '{not-json');

    expect(handler).not.toHaveBeenCalled();
  });

  it('serializes publish payloads and disconnects both clients on close', async () => {
    const publishClient = new MockRedisClient();
    const subscribeClient = new MockRedisClient();
    const transport = new RedisEventBusTransport({
      publishClient: publishClient as never,
      subscribeClient: subscribeClient as never,
    });

    await transport.publish('AuditEvent', { ok: true });

    expect(publishClient.publishes).toEqual([{ channel: 'AuditEvent', message: '{"ok":true}' }]);

    await transport.close();

    expect(publishClient.disconnectCalls).toBe(1);
    expect(subscribeClient.disconnectCalls).toBe(1);
  });
});
