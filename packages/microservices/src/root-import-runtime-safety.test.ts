import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

const netMockState = vi.hoisted(() => ({
  loads: 0,
}));

describe('@fluojs/microservices root import runtime safety', () => {
  it('does not load node:net until TCP listen or outbound construction paths run', async () => {
    vi.resetModules();
    netMockState.loads = 0;
    vi.doMock('node:net', () => {
      netMockState.loads += 1;

      return {
        Socket: class MockSocket {},
        createServer: () => {
          throw new Error('node:net should be loaded lazily by TCP runtime paths only');
        },
      };
    });

    try {
      const microservices = await import('./index.js');

      expect(microservices).toHaveProperty('MicroservicesModule');
      expect(microservices).toHaveProperty('TcpMicroserviceTransport');
      expect(netMockState.loads).toBe(0);

      const transport = new microservices.TcpMicroserviceTransport({ port: 0 });

      expect(transport).toBeInstanceOf(microservices.TcpMicroserviceTransport);
      expect(netMockState.loads).toBe(0);
      await expect(transport.listen(async () => undefined)).rejects.toThrow(
        'node:net should be loaded lazily by TCP runtime paths only',
      );
      expect(netMockState.loads).toBe(1);
    } finally {
      vi.doUnmock('node:net');
    }
  });

  it('keeps outbound send rejection lazy before TCP starts listening', async () => {
    vi.resetModules();
    netMockState.loads = 0;
    vi.doMock('node:net', () => {
      netMockState.loads += 1;

      return {
        Socket: class MockSocket {},
        createServer: () => {
          throw new Error('node:net should not load for pre-listen outbound rejection');
        },
      };
    });

    try {
      const { TcpMicroserviceTransport } = await import('./index.js');
      const transport = new TcpMicroserviceTransport({ port: 0 });

      await expect(transport.send('lazy.outbound', {})).rejects.toThrow(
        'TcpMicroserviceTransport is not listening. Call listen() before send().',
      );
      expect(netMockState.loads).toBe(0);
    } finally {
      vi.doUnmock('node:net');
    }
  });

  it('keeps close() joined to an in-flight TCP listen attempt through server.listen cleanup', async () => {
    vi.resetModules();

    let listenCallback: (() => void) | undefined;
    let closeCalls = 0;
    let listenCalls = 0;

    class MockServer extends EventEmitter {
      listening = false;

      address() {
        return { address: '127.0.0.1', family: 'IPv4', port: 41234 };
      }

      close(callback: (error?: Error) => void): void {
        closeCalls += 1;
        this.listening = false;
        callback();
      }

      listen(_port: number, _host: string, callback: () => void): void {
        listenCalls += 1;
        listenCallback = () => {
          this.listening = true;
          callback();
        };
      }
    }

    vi.doMock('node:net', () => ({
      Socket: class MockSocket {},
      createServer: () => new MockServer(),
    }));

    try {
      const { TcpMicroserviceTransport } = await import('./index.js');
      const transport = new TcpMicroserviceTransport({ port: 0 });
      const listenPromise = transport.listen(async () => undefined);

      await waitForCondition(() => listenCalls === 1 && typeof listenCallback === 'function');

      const closePromise = transport.close();

      expect(closeCalls).toBe(0);
      listenCallback?.();
      await expect(listenPromise).rejects.toThrow(
        'TcpMicroserviceTransport is closing. Wait for close() to complete before listen().',
      );
      await expect(closePromise).rejects.toThrow(
        'TcpMicroserviceTransport is closing. Wait for close() to complete before listen().',
      );
      expect(closeCalls).toBe(1);
    } finally {
      vi.doUnmock('node:net');
    }
  });

  it('serializes concurrent TCP listen() calls so only one server is created and tracked', async () => {
    vi.resetModules();

    const listenCallbacks: Array<() => void> = [];
    let createServerCalls = 0;
    let listenCalls = 0;

    class MockServer extends EventEmitter {
      listening = false;

      address() {
        return { address: '127.0.0.1', family: 'IPv4', port: 41235 };
      }

      close(callback: (error?: Error) => void): void {
        this.listening = false;
        callback();
      }

      listen(_port: number, _host: string, callback: () => void): void {
        listenCalls += 1;
        listenCallbacks.push(() => {
          this.listening = true;
          callback();
        });
      }
    }

    vi.doMock('node:net', () => ({
      Socket: class MockSocket {},
      createServer: () => {
        createServerCalls += 1;
        return new MockServer();
      },
    }));

    try {
      const { TcpMicroserviceTransport } = await import('./index.js');
      const transport = new TcpMicroserviceTransport({ port: 0 });
      const firstListen = transport.listen(async () => undefined);
      const secondListen = transport.listen(async () => undefined);

      await waitForCondition(() => listenCallbacks.length === 1);

      listenCallbacks[0]?.();

      await expect(Promise.all([firstListen, secondListen])).resolves.toEqual([undefined, undefined]);
      expect(createServerCalls).toBe(1);
      expect(listenCalls).toBe(1);

      await transport.close();
    } finally {
      vi.doUnmock('node:net');
    }
  });
});

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for expected test condition.');
}
