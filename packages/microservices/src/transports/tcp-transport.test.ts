import { Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TcpMicroserviceTransport } from './tcp-transport.js';

describe('TcpMicroserviceTransport', () => {
  const transports: TcpMicroserviceTransport[] = [];

  afterEach(async () => {
    await Promise.allSettled(transports.map((transport) => transport.close()));
    transports.length = 0;
  });

  const createTransport = (options: ConstructorParameters<typeof TcpMicroserviceTransport>[0]) => {
    const transport = new TcpMicroserviceTransport(options);
    transports.push(transport);
    return transport;
  };

  it('closes sockets that exceed the inbound frame buffer cap', async () => {
    const port = 0;
    const handler = vi.fn(async () => undefined);
    const transport = createTransport({ port, requestTimeoutMs: 1_000 });

    await transport.listen(handler);

    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();

      socket.once('close', () => resolve());
      socket.once('error', () => resolve());
      socket.connect((transport as unknown as { boundPort: number }).boundPort, '127.0.0.1', () => {
        socket.write('x'.repeat(1_048_577));
      });

      setTimeout(() => reject(new Error('Timed out waiting for oversized TCP frame to close.')), 1_000);
    });

    expect(handler).not.toHaveBeenCalled();

  });

  it('removes abort listener after a request completes normally', async () => {
    const port = 0;
    const transport = createTransport({ port, requestTimeoutMs: 1_000 });

    await transport.listen(async () => 'ok');

    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(transport.send('success.pattern', {}, controller.signal)).resolves.toBe('ok');

    expect(removeEventListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));

  });

  it('rejects send and emit after close() stops the listener', async () => {
    const transport = createTransport({ port: 0, requestTimeoutMs: 1_000 });

    await transport.listen(async () => 'ok');
    await transport.close();

    await expect(transport.send('closed.pattern', {})).rejects.toThrow(
      'TcpMicroserviceTransport is closing. Wait for close() to complete before send().',
    );
    await expect(transport.emit('closed.event', {})).rejects.toThrow(
      'TcpMicroserviceTransport is closing. Wait for close() to complete before emit().',
    );
  });

  it('keeps the closing guard when listen() races with close()', async () => {
    const transport = createTransport({ port: 0, requestTimeoutMs: 1_000 });

    await transport.listen(async () => 'ok');

    const closePromise = transport.close();
    await expect(transport.listen(async () => 'reopened')).rejects.toThrow(
      'TcpMicroserviceTransport is closing. Wait for close() to complete before listen().',
    );
    await expect(transport.send('closing.pattern', {})).rejects.toThrow(
      'TcpMicroserviceTransport is closing. Wait for close() to complete before send().',
    );
    await expect(transport.emit('closing.event', {})).rejects.toThrow(
      'TcpMicroserviceTransport is closing. Wait for close() to complete before emit().',
    );

    await closePromise;
  });
});
