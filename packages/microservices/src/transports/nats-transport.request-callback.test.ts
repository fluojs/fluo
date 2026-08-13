import { TextDecoder, TextEncoder } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NatsMicroserviceTransport } from './nats-transport.js';

interface RequestMessage {
  readonly data: Uint8Array;
  respond(data: Uint8Array): void;
}

class RequestCallbackNatsClient {
  closeCalled = false;
  private requestHandler: ((message: RequestMessage) => void) | undefined;

  publish(): void {
    return;
  }

  async request(): Promise<{ data: Uint8Array }> {
    throw new Error('Outbound requests are not used by this fixture.');
  }

  subscribe(subject: string, handler: (message: RequestMessage) => void): { unsubscribe(): void } {
    if (subject === 'fluo.microservices.messages') {
      this.requestHandler = handler;
    }

    return {
      unsubscribe: () => {
        if (this.requestHandler === handler) {
          this.requestHandler = undefined;
        }
      },
    };
  }

  dispatchRequest(data: Uint8Array, respond: RequestMessage['respond']): void {
    if (!this.requestHandler) {
      throw new Error('Expected a NATS request callback to be registered.');
    }

    this.requestHandler({ data, respond });
  }

  close(): void {
    this.closeCalled = true;
  }
}

const codec = {
  decode(data: Uint8Array): string {
    return new TextDecoder().decode(data);
  },
  encode(value: string): Uint8Array {
    return new TextEncoder().encode(value);
  },
};

describe('NatsMicroserviceTransport request callback boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains malformed request frames and reports the decode failure through the transport logger', async () => {
    // Given
    const client = new RequestCallbackNatsClient();
    const handler = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const transport = new NatsMicroserviceTransport({ client, codec });
    transport.setLogger(logger);
    await transport.listen(handler);

    // When
    client.dispatchRequest(codec.encode('{not-json'), () => undefined);

    // Then
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Request callback failed.',
        expect.any(Error),
        'NatsMicroserviceTransport',
      );
    });
    expect(handler).not.toHaveBeenCalled();
    expect(client.closeCalled).toBe(false);

    await transport.close();
    expect(client.closeCalled).toBe(false);
  });

  it('contains throwing request responses and reports the response failure through the transport logger', async () => {
    // Given
    const client = new RequestCallbackNatsClient();
    const logger = { error: vi.fn() };
    const responseError = new Error('NATS response failed');
    const respond = vi.fn(() => {
      throw responseError;
    });
    const transport = new NatsMicroserviceTransport({ client, codec });
    transport.setLogger(logger);
    await transport.listen(async () => ({ reserved: true }));
    const frame = codec.encode(
      JSON.stringify({ kind: 'message', pattern: 'inventory.reserve', payload: {} }),
    );

    // When
    client.dispatchRequest(frame, respond);

    // Then
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Request callback failed.',
        responseError,
        'NatsMicroserviceTransport',
      );
    });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(client.closeCalled).toBe(false);

    await transport.close();
    expect(client.closeCalled).toBe(false);
  });

  it('contains response encoding failures and reports them through the transport logger', async () => {
    // Given
    const client = new RequestCallbackNatsClient();
    const logger = { error: vi.fn() };
    const encodeError = new Error('NATS response encoding failed');
    const failingCodec = {
      decode(data: Uint8Array): string {
        return codec.decode(data);
      },
      encode(value: string): Uint8Array {
        if (value.includes('reserved')) {
          throw encodeError;
        }

        return codec.encode(value);
      },
    };
    const transport = new NatsMicroserviceTransport({ client, codec: failingCodec });
    transport.setLogger(logger);
    await transport.listen(async () => ({ reserved: true }));

    // When
    client.dispatchRequest(
      codec.encode(JSON.stringify({ kind: 'message', pattern: 'inventory.reserve', payload: {} })),
      () => undefined,
    );

    // Then
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Request callback failed.',
        encodeError,
        'NatsMicroserviceTransport',
      );
    });

    await transport.close();
    expect(client.closeCalled).toBe(false);
  });

  it('contains logger failures when the request callback boundary reports a malformed frame', async () => {
    // Given
    const client = new RequestCallbackNatsClient();
    const loggerError = new Error('logger failed');
    const logger = {
      error: vi.fn(() => {
        throw loggerError;
      }),
    };
    const transport = new NatsMicroserviceTransport({ client, codec });
    transport.setLogger(logger);
    await transport.listen(async () => undefined);
    const unhandledRejection = vi.fn();

    process.on('unhandledRejection', unhandledRejection);
    try {
      // When
      client.dispatchRequest(codec.encode('{not-json'), () => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then
      expect(logger.error).toHaveBeenCalledWith(
        'Request callback failed.',
        expect.any(Error),
        'NatsMicroserviceTransport',
      );
      expect(unhandledRejection).not.toHaveBeenCalled();
      expect(client.closeCalled).toBe(false);
    } finally {
      process.off('unhandledRejection', unhandledRejection);
      await transport.close();
      expect(client.closeCalled).toBe(false);
    }
  });

  it('does not fall back to console.error when a request callback fails without a logger', async () => {
    // Given
    const client = new RequestCallbackNatsClient();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = new NatsMicroserviceTransport({ client, codec });
    await transport.listen(async () => undefined);

    // When
    client.dispatchRequest(codec.encode('{not-json'), () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Then
    expect(consoleError).not.toHaveBeenCalled();

    await transport.close();
  });
});
