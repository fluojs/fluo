import { Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TcpMicroserviceTransport } from './tcp-transport.js';

describe('TcpMicroserviceTransport UTF-8 framing', () => {
  const transports: TcpMicroserviceTransport[] = [];

  afterEach(async () => {
    await Promise.allSettled(transports.map((transport) => transport.close()));
    transports.length = 0;
  });

  const createTransport = () => {
    const transport = new TcpMicroserviceTransport({ port: 0, requestTimeoutMs: 1_000 });
    transports.push(transport);
    return transport;
  };

  it('preserves a request payload when a UTF-8 code point is split across socket chunks', async () => {
    const handler = vi.fn(async () => 'ok');
    const transport = createTransport();

    await transport.listen(handler);
    const socket = new Socket();
    await connectSocket(socket, readTcpBoundPort(transport));

    writeLineWithSplitCodePoint(
      socket,
      JSON.stringify({
        kind: 'message',
        pattern: 'catalog.get',
        payload: { name: '한정판' },
        requestId: 'split-request',
      }),
      '한',
    );

    await waitForHandler(handler);
    expect(handler).toHaveBeenCalledWith({
      kind: 'message',
      pattern: 'catalog.get',
      payload: { name: '한정판' },
      requestId: 'split-request',
    });
    socket.destroy();
  });

  it('preserves a response payload when a UTF-8 code point is split across socket chunks', async () => {
    const responsePayload = { name: '한정판' };
    const transport = createTransport();
    Object.defineProperty(transport, 'writeLine', {
      configurable: true,
      value: (socket: Socket, line: string) => {
        if (line.includes(responsePayload.name)) {
          writeLineWithSplitCodePoint(socket, line, '한');
          return;
        }

        socket.write(`${line}\n`);
      },
    });

    await transport.listen(async () => responsePayload);

    await expect(transport.send('catalog.get', {})).resolves.toEqual(responsePayload);
  });

  it('preserves an event payload when a UTF-8 code point is split across socket chunks', async () => {
    const handler = vi.fn(async () => undefined);
    const transport = createTransport();

    await transport.listen(handler);
    const socket = new Socket();
    await connectSocket(socket, readTcpBoundPort(transport));

    writeLineWithSplitCodePoint(
      socket,
      JSON.stringify({
        kind: 'event',
        pattern: 'catalog.updated',
        payload: { name: '한정판' },
      }),
      '한',
    );

    await waitForHandler(handler);
    expect(handler).toHaveBeenCalledWith({
      kind: 'event',
      pattern: 'catalog.updated',
      payload: { name: '한정판' },
    });
    socket.destroy();
  });
});

function readTcpBoundPort(transport: TcpMicroserviceTransport): number {
  const port = Object.getOwnPropertyDescriptor(transport, 'boundPort')?.value;

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

function writeLineWithSplitCodePoint(socket: Socket, line: string, codePoint: string): void {
  const frame = Buffer.from(`${line}\n`);
  const encodedCodePoint = Buffer.from(codePoint);
  const codePointIndex = frame.indexOf(encodedCodePoint);

  if (codePointIndex < 0 || encodedCodePoint.length < 2) {
    throw new Error('Expected a multibyte UTF-8 code point in the TCP test frame.');
  }

  const splitIndex = codePointIndex + 1;
  socket.write(frame.subarray(0, splitIndex), () => {
    setTimeout(() => socket.write(frame.subarray(splitIndex)), 10);
  });
}

async function waitForHandler(handler: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (handler.mock.calls.length === 1) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Timed out waiting for the TCP handler.');
}
