import { TextDecoder, TextEncoder } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { NatsMicroserviceTransport } from './nats-transport.js';

interface TestNatsMessage {
  readonly data: Uint8Array;
  respond(data: Uint8Array): void;
}

interface TestUnsubscribes {
  readonly event: () => void;
  readonly message: () => void;
}

function createCodec() {
  return {
    decode(data: Uint8Array) {
      return new TextDecoder().decode(data);
    },
    encode(value: string) {
      return new TextEncoder().encode(value);
    },
  };
}

function createClient(unsubscribes: TestUnsubscribes) {
  return {
    publish(_subject: string, _payload: Uint8Array): void {
      return;
    },
    async request(_subject: string, _payload: Uint8Array): Promise<{ data: Uint8Array }> {
      return { data: new Uint8Array() };
    },
    subscribe(subject: string, _handler: (message: TestNatsMessage) => void) {
      return {
        unsubscribe: subject === 'fluo.microservices.events' ? unsubscribes.event : unsubscribes.message,
      };
    },
  };
}

describe('NatsMicroserviceTransport subscription cleanup', () => {
  it('attempts every subscription when one cleanup fails', async () => {
    // Given
    const eventCleanupError = new Error('event subscription cleanup failed');
    const eventUnsubscribe = vi.fn(() => {
      throw eventCleanupError;
    });
    const messageUnsubscribe = vi.fn();
    const client = createClient({ event: eventUnsubscribe, message: messageUnsubscribe });
    const transport = new NatsMicroserviceTransport({ client, codec: createCodec() });
    await transport.listen(async () => undefined);

    // When
    const firstClose = transport.close();

    // Then
    await expect(firstClose).rejects.toBe(eventCleanupError);
    expect(eventUnsubscribe).toHaveBeenCalledTimes(1);
    expect(messageUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries only subscriptions whose cleanup failed', async () => {
    // Given
    const eventCleanupError = new Error('event subscription cleanup failed');
    let eventCleanupAttempts = 0;
    const eventUnsubscribe = vi.fn(() => {
      eventCleanupAttempts += 1;
      if (eventCleanupAttempts === 1) {
        throw eventCleanupError;
      }
    });
    const messageUnsubscribe = vi.fn();
    const client = createClient({ event: eventUnsubscribe, message: messageUnsubscribe });
    const transport = new NatsMicroserviceTransport({ client, codec: createCodec() });
    await transport.listen(async () => undefined);
    await expect(transport.close()).rejects.toBe(eventCleanupError);

    // When
    const retry = transport.close();

    // Then
    await expect(retry).resolves.toBeUndefined();
    expect(eventUnsubscribe).toHaveBeenCalledTimes(2);
    expect(messageUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not resume listening while failed subscription cleanup remains', async () => {
    // Given
    const eventCleanupError = new Error('event subscription cleanup failed');
    const eventUnsubscribe = vi.fn(() => {
      throw eventCleanupError;
    });
    const client = createClient({ event: eventUnsubscribe, message: vi.fn() });
    const transport = new NatsMicroserviceTransport({ client, codec: createCodec() });
    await transport.listen(async () => undefined);
    await expect(transport.close()).rejects.toBe(eventCleanupError);

    // When
    const listening = transport.listen(async () => undefined);

    // Then
    await expect(listening).rejects.toThrow(
      'NATS subscription cleanup is incomplete. Call close() again before listen().',
    );
  });

  it('aggregates evidence when multiple subscription cleanup attempts fail', async () => {
    // Given
    const eventCleanupError = new Error('event subscription cleanup failed');
    const messageCleanupError = new Error('message subscription cleanup failed');
    const eventUnsubscribe = vi.fn(() => {
      throw eventCleanupError;
    });
    const messageUnsubscribe = vi.fn(() => {
      throw messageCleanupError;
    });
    const client = createClient({ event: eventUnsubscribe, message: messageUnsubscribe });
    const transport = new NatsMicroserviceTransport({ client, codec: createCodec() });
    await transport.listen(async () => undefined);

    // When
    const closing = transport.close();

    // Then
    await expect(closing).rejects.toEqual(
      new AggregateError(
        [eventCleanupError, messageCleanupError],
        'NATS subscription cleanup failed for multiple subscriptions.',
      ),
    );
    expect(eventUnsubscribe).toHaveBeenCalledTimes(1);
    expect(messageUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
