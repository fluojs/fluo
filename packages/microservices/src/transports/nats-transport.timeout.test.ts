import { TextDecoder, TextEncoder } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NatsMicroserviceTransport } from './nats-transport.js';

interface NatsRequestOptions {
  readonly timeout?: number;
}

class TimeoutNatsClient {
  requestOptions: NatsRequestOptions | undefined;
  readonly timeoutError = new Error('NATS request timed out.');

  publish(_subject: string, _payload: Uint8Array): void {
    return;
  }

  request(
    _subject: string,
    _payload: Uint8Array,
    options?: NatsRequestOptions,
  ): Promise<{ data: Uint8Array }> {
    this.requestOptions = options;

    return new Promise<{ data: Uint8Array }>((_resolve, reject) => {
      setTimeout(() => {
        reject(this.timeoutError);
      }, options?.timeout);
    });
  }

  subscribe(
    _subject: string,
    _handler: (message: { data: Uint8Array; respond(data: Uint8Array): void }) => void,
  ) {
    return {
      unsubscribe() {
        return;
      },
    };
  }
}

describe('NatsMicroserviceTransport request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('propagates requestTimeoutMs and rejects when NATS does not respond', async () => {
    // Given
    vi.useFakeTimers();
    const requestTimeoutMs = 1_500;
    const nats = new TimeoutNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const transport = new NatsMicroserviceTransport({ client: nats, codec, requestTimeoutMs });
    await transport.listen(async () => undefined);

    // When
    const sending = transport.send('inventory.reserve-preview', { sku: 'sku-1' });
    const timeoutRejection = expect(sending).rejects.toBe(nats.timeoutError);
    await Promise.resolve();

    // Then
    expect(nats.requestOptions).toEqual({ timeout: requestTimeoutMs });
    await vi.advanceTimersByTimeAsync(requestTimeoutMs);
    await timeoutRejection;
    expect(vi.getTimerCount()).toBe(0);
    await expect(transport.close()).resolves.toBeUndefined();
  });
});
