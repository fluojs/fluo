import { TextDecoder, TextEncoder } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { NatsMicroserviceTransport } from './nats-transport.js';

class InMemoryNatsClient {
  private readonly subscriptions = new Map<string, Set<(message: { data: Uint8Array; respond(data: Uint8Array): void }) => void>>();
  closeError: Error | undefined;

  subscribe(subject: string, handler: (message: { data: Uint8Array; respond(data: Uint8Array): void }) => void) {
    const handlers = this.subscriptions.get(subject) ?? new Set<typeof handler>();
    handlers.add(handler);
    this.subscriptions.set(subject, handlers);

    return {
      unsubscribe: () => {
        const currentHandlers = this.subscriptions.get(subject);
        if (!currentHandlers) {
          return;
        }

        currentHandlers.delete(handler);

        if (currentHandlers.size === 0) {
          this.subscriptions.delete(subject);
        }
      },
    };
  }

  publish(subject: string, payload: Uint8Array): void {
    const handlers = this.subscriptions.get(subject);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler({
        data: payload,
        respond: () => {
          return;
        },
      });
    }
  }

  async request(subject: string, payload: Uint8Array): Promise<{ data: Uint8Array }> {
    const handlers = this.subscriptions.get(subject);

    if (!handlers || handlers.size === 0) {
      throw new Error(`No NATS subscribers for subject ${subject}.`);
    }

    return await new Promise<{ data: Uint8Array }>((resolve) => {
      const first = handlers.values().next().value as
        | ((message: { data: Uint8Array; respond(data: Uint8Array): void }) => void)
        | undefined;

      if (!first) {
        resolve({ data: new Uint8Array() });
        return;
      }

      first({
        data: payload,
        respond(data) {
          resolve({ data });
        },
      });
    });
  }

  close(): void {
    this.subscriptions.clear();

    if (this.closeError) {
      throw this.closeError;
    }
  }
}

describe('NatsMicroserviceTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports request/reply and event dispatch', async () => {
    const nats = new InMemoryNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const events: number[] = [];

    const transport = new NatsMicroserviceTransport({ client: nats, codec });
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: number }).value);
        return undefined;
      }

      const input = packet.payload as { a: number; b: number };
      return input.a + input.b;
    });

    await expect(transport.send('math.sum', { a: 2, b: 5 })).resolves.toBe(7);
    await transport.emit('audit.value', { value: 9 });
    expect(events).toEqual([9]);

    await transport.close();
  });

  it('isolates event handler failures from the NATS subscription callback', async () => {
    const nats = new InMemoryNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const logger = { error: vi.fn() };

    const transport = new NatsMicroserviceTransport({ client: nats, codec });
    transport.setLogger(logger);
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('nats event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'nats event failed' }),
      'NatsMicroserviceTransport',
    );

    await transport.close();
  });

  it('does not fall back to console.error when no logger is configured', async () => {
    const nats = new InMemoryNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const transport = new NatsMicroserviceTransport({ client: nats, codec });
    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('nats event failed without logger');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).not.toHaveBeenCalled();

    await transport.close();
  });

  it('isolates malformed inbound event frames from the NATS subscription callback', async () => {
    const nats = new InMemoryNatsClient();
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const logger = { error: vi.fn() };

    const transport = new NatsMicroserviceTransport({ client: nats, codec });
    transport.setLogger(logger);
    await transport.listen(async () => undefined);

    nats.publish('fluo.microservices.events', new TextEncoder().encode('{not-json'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.any(Error),
      'NatsMicroserviceTransport',
    );

    await transport.close();
  });

  it('rejects pending requests when close() runs before a reply', async () => {
    const nats = new InMemoryNatsClient();
    let resolveRequestRelease!: () => void;
    let resolveRequestStarted!: () => void;
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const requestRelease = new Promise<void>((resolve) => {
      resolveRequestRelease = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });

    nats.request = vi.fn(async () => {
      resolveRequestStarted();
      await requestRelease;
      return { data: codec.encode(JSON.stringify({ payload: { value: 1 } })) };
    });

    const transport = new NatsMicroserviceTransport({ client: nats, codec, requestTimeoutMs: 5_000 });
    await transport.listen(async () => undefined);

    const pending = transport.send('long.running', { value: 1 });
    await requestStarted;
    await transport.close();

    await expect(pending).rejects.toThrow('NATS microservice transport closed before response.');

    resolveRequestRelease();
    await Promise.resolve();
  });

  it('still rejects pending requests when client.close fails during close', async () => {
    const nats = new InMemoryNatsClient();
    const closeError = new Error('close failed');
    let resolveRequestRelease!: () => void;
    let resolveRequestStarted!: () => void;
    const codec = {
      decode(data: Uint8Array) {
        return new TextDecoder().decode(data);
      },
      encode(value: string) {
        return new TextEncoder().encode(value);
      },
    };
    const requestRelease = new Promise<void>((resolve) => {
      resolveRequestRelease = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });

    nats.request = vi.fn(async () => {
      resolveRequestStarted();
      await requestRelease;
      return { data: codec.encode(JSON.stringify({ payload: { value: 1 } })) };
    });

    nats.closeError = closeError;

    const transport = new NatsMicroserviceTransport({ client: nats, codec, requestTimeoutMs: 5_000 });
    await transport.listen(async () => undefined);

    const pending = transport.send('long.running', { value: 1 });
    await requestStarted;

    await expect(transport.close()).rejects.toBe(closeError);
    await expect(pending).rejects.toThrow('NATS microservice transport closed before response.');

    resolveRequestRelease();
    await Promise.resolve();
  });
});
