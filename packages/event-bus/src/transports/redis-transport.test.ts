import { describe, expect, it, vi } from 'vitest';

import { RedisEventBusTransport } from './redis-transport.js';

class MockRedisClient {
  readonly messageListeners: Array<(channel: string, message: string) => void> = [];
  readonly publishes: Array<{ channel: string; message: string }> = [];
  readonly subscribedChannels: string[] = [];
  readonly unsubscribedChannels: string[][] = [];
  disconnectCalls = 0;
  offCalls = 0;

  on(event: string, listener: (channel: string, message: string) => void): this {
    if (event === 'message') {
      this.messageListeners.push(listener);
    }

    return this;
  }

  off(event: string, listener: (channel: string, message: string) => void): this {
    if (event === 'message') {
      this.offCalls += 1;
      const index = this.messageListeners.indexOf(listener);

      if (index >= 0) {
        this.messageListeners.splice(index, 1);
      }
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

  async unsubscribe(...channels: string[]): Promise<void> {
    this.unsubscribedChannels.push(channels);
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

  it('serializes publish payloads and only cleans up transport-owned subscriptions on close', async () => {
    const publishClient = new MockRedisClient();
    const subscribeClient = new MockRedisClient();
    const transport = new RedisEventBusTransport({
      publishClient: publishClient as never,
      subscribeClient: subscribeClient as never,
    });

    await transport.publish('AuditEvent', { ok: true });
    await transport.subscribe('AuditEvent', async () => undefined);

    expect(publishClient.publishes).toEqual([{ channel: 'AuditEvent', message: '{"ok":true}' }]);

    await transport.close();

    expect(publishClient.disconnectCalls).toBe(0);
    expect(subscribeClient.disconnectCalls).toBe(0);
    expect(subscribeClient.unsubscribedChannels).toEqual([['AuditEvent']]);
    expect(subscribeClient.offCalls).toBe(1);
    expect(subscribeClient.messageListeners).toHaveLength(0);
  });

  it('ignores late messages after close detaches transport listeners', async () => {
    const transport = new RedisEventBusTransport({
      publishClient: new MockRedisClient() as never,
      subscribeClient: new MockRedisClient() as never,
    });
    const handler = vi.fn(async (_payload: unknown) => undefined);
    const subscribeClient = (transport as unknown as { subscribeClient: MockRedisClient }).subscribeClient;

    await transport.subscribe('AuditEvent', handler);
    await transport.close();
    subscribeClient.emitMessage('AuditEvent', JSON.stringify({ ignored: true }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('still detaches listeners when unsubscribe fails during close', async () => {
    const publishClient = new MockRedisClient();
    const subscribeClient = new MockRedisClient();
    const transport = new RedisEventBusTransport({
      publishClient: publishClient as never,
      subscribeClient: subscribeClient as never,
    });

    subscribeClient.unsubscribe = vi.fn(async () => {
      throw new Error('unsubscribe failed');
    });

    await transport.subscribe('AuditEvent', async () => undefined);

    await expect(transport.close()).rejects.toThrow('unsubscribe failed');

    expect(publishClient.disconnectCalls).toBe(0);
    expect(subscribeClient.disconnectCalls).toBe(0);
    expect(subscribeClient.offCalls).toBe(1);
    expect(subscribeClient.messageListeners).toHaveLength(0);
  });
});
