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

  it('reports that TCP owns its listener and socket resources', () => {
    const transport = createTransport({ port: 0 });

    expect(transport.ownsResources).toBe(true);
  });

  it('closes sockets that exceed the inbound frame buffer cap', async () => {
    const handler = vi.fn(async () => undefined);
    const transport = createTransport({ port: 0, requestTimeoutMs: 1_000 });

    await transport.listen(handler);
    const port = readTcpBoundPort(transport);

    const socket = new Socket();

    await connectSocket(socket, port);
    socket.write('x'.repeat(1_048_577));
    await expectSocketTermination(socket, 'oversized TCP frame');

    expect(handler).not.toHaveBeenCalled();

  });

  it('routes outbound send and emit through the OS-assigned port when configured with port 0', async () => {
    const events: string[] = [];
    const transport = createTransport({ port: 0, requestTimeoutMs: 1_000 });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        events.push((packet.payload as { value: string }).value);
        return undefined;
      }

      const input = packet.payload as { value: number };
      return input.value * 2;
    });

    await expect(transport.send('calc.double', { value: 3 })).resolves.toBe(6);
    await expect(transport.emit('audit.event', { value: 'ok' })).resolves.toBeUndefined();
    await waitForCondition(() => events.length === 1);
    expect(events).toEqual(['ok']);
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

  it('rejects send when AbortSignal is already aborted', async () => {
    const transport = createTransport({ port: 0, requestTimeoutMs: 1_000 });

    await transport.listen(async () => 'ok');

    const controller = new AbortController();
    controller.abort();

    await expect(transport.send('aborted.before.dispatch', {}, controller.signal)).rejects.toThrow(
      'Microservice send aborted before dispatch.',
    );
  });

  it('rejects in-flight send when AbortSignal aborts', async () => {
    const transport = createTransport({ port: 0, requestTimeoutMs: 5_000 });
    let markHandlerEntered!: () => void;
    const handlerEntered = new Promise<void>((resolve) => {
      markHandlerEntered = resolve;
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'message') {
        markHandlerEntered();
        await new Promise<void>(() => undefined);
      }

      return undefined;
    });

    const controller = new AbortController();
    const pending = transport.send('aborted.inflight', {}, controller.signal);

    await handlerEntered;
    controller.abort();

    await expect(pending).rejects.toThrow('Microservice send aborted.');
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

function readTcpBoundPort(transport: TcpMicroserviceTransport): number {
  const descriptor = Object.getOwnPropertyDescriptor(transport, 'boundPort');
  const port = descriptor?.value;

  if (typeof port !== 'number') {
    throw new Error('Expected TCP transport to expose a numeric boundPort after listen().');
  }

  return port;
}

async function connectSocket(socket: Socket, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.connect(port, '127.0.0.1', () => {
      socket.off('error', reject);
      resolve();
    });
  });
}

async function expectSocketTermination(socket: Socket, reason: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `Timed out waiting for ${reason} termination; destroyed=${String(socket.destroyed)}, connecting=${String(
            socket.connecting,
          )}, bytesWritten=${String(socket.bytesWritten)}, bytesRead=${String(socket.bytesRead)}.`,
        ),
      );
    }, 5_000);
    const ignoreLateError = () => undefined;

    const settle = () => {
      clearTimeout(timeout);
      socket.removeAllListeners('close');
      socket.removeListener('error', settle);
      resolve();
    };

    socket.on('error', ignoreLateError);
    socket.once('close', settle);
    socket.once('error', settle);
  });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for TCP test condition.');
}
