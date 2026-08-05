import { connect } from 'node:net';

import { describe, expect, it } from 'vitest';

import { startStudioSidecar } from './sidecar.js';

const SHUTDOWN_TEST_TIMEOUT_MS = 1_000;

describe('Studio sidecar shutdown admission', () => {
  it('settles late authenticated ingestion on an established socket after shutdown starts', async () => {
    // Given an authenticated keep-alive connection established before shutdown.
    const sidecar = await startStudioSidecar({ appId: 'test-app', heartbeatMs: 0, runtime: 'node' });
    const socket = connect(sidecar.port, '127.0.0.1');
    const socketSettled = new Promise<void>((resolve) => {
      socket.once('error', () => resolve());
      socket.once('close', () => resolve());
    });

    try {
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      socket.setEncoding('utf8');
      await new Promise<void>((resolve, reject) => {
        let response = '';
        const onError = (error: Error): void => reject(error);
        const onData = (chunk: string): void => {
          response += chunk;
          if (!response.includes('"sequence":0')) {
            return;
          }
          socket.off('data', onData);
          socket.off('error', onError);
          resolve();
        };
        socket.on('data', onData);
        socket.once('error', onError);
        socket.write(
          `GET /api/state?token=${encodeURIComponent(sidecar.token)} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${String(sidecar.port)}\r\n` +
          `Connection: keep-alive\r\n` +
          `Content-Length: 1\r\n` +
          `\r\n`,
        );
      });

      // When shutdown starts before an incomplete authenticated ingestion is pipelined.
      const closing = sidecar.close();
      expect(socket.destroyed).toBe(false);
      socket.write(
        `xPOST /api/runtime/events HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${String(sidecar.port)}\r\n` +
        `Authorization: Bearer ${sidecar.token}\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: 1000\r\n` +
        `\r\n` +
        `{"payload":{"phase":"scheduled"},"source":`,
      );

      let timeout: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        Promise.all([closing, socketSettled]).then(() => 'closed' as const),
        new Promise<'timed-out'>((resolve) => {
          timeout = setTimeout(() => resolve('timed-out'), SHUTDOWN_TEST_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });

      // Then late ingestion cannot keep either the socket or shared shutdown pending.
      expect(result).toBe('closed');
      await expect(sidecar.close()).resolves.toBeUndefined();
    } finally {
      socket.destroy();
      await sidecar.close();
    }
  });
});
