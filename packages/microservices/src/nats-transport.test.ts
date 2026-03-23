import { TextDecoder, TextEncoder } from 'node:util';

import { describe, expect, it } from 'vitest';

import { NatsMicroserviceTransport } from './nats-transport.js';

class InMemoryNatsClient {
  private readonly subscriptions = new Map<string, Set<(message: { data: Uint8Array; respond(data: Uint8Array): void }) => void>>();

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
  }
}

describe('NatsMicroserviceTransport', () => {
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
});
