import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type StudioViewerServer, startStudioViewerServer, viewerServerCloseGracePeriodMs } from './viewer-server.js';

const temporaryDirectories: string[] = [];
const servers: StudioViewerServer[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Studio viewer server close', () => {
  it('shares one terminal close promise across concurrent and repeated calls', async () => {
    // Given: a running viewer server with no active client connections.
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    temporaryDirectories.push(viewerDirectory);
    await writeFile(join(viewerDirectory, 'index.html'), '<div id="app"></div>');
    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);

    // When: callers concurrently request shutdown, then request it again after it settles.
    const firstClose = server.close();
    const concurrentClose = server.close();
    await firstClose;
    const repeatedClose = server.close();

    // Then: every caller receives the same terminal outcome without reopening server.close.
    expect(concurrentClose).toBe(firstClose);
    expect(repeatedClose).toBe(firstClose);
    await expect(Promise.all([concurrentClose, repeatedClose])).resolves.toEqual([undefined, undefined]);
  });

  it('forces its incomplete raw socket closed exactly at the bounded grace period', async () => {
    // Given: a viewer server with a connected peer that never completes an HTTP request.
    const viewerDirectory = await mkdtemp(join(tmpdir(), 'fluo-studio-viewer-'));
    temporaryDirectories.push(viewerDirectory);
    await writeFile(join(viewerDirectory, 'index.html'), '<div id="app"></div>');
    const server = await startStudioViewerServer({ port: 0, viewerDirectory });
    servers.push(server);
    const socket = new Socket();
    socket.on('error', () => undefined);
    await new Promise<void>((resolveConnection, rejectConnection) => {
      const rejectFromError = (error: Error): void => {
        socket.off('error', rejectFromError);
        rejectConnection(error);
      };
      socket.once('error', rejectFromError);
      socket.connect({ host: server.url.hostname, port: Number(server.url.port) }, () => {
        socket.off('error', rejectFromError);
        resolveConnection();
      });
    });

    // When: shutdown reaches its documented forced-cleanup deadline.
    let stopping: Promise<void> | undefined;
    try {
      vi.useFakeTimers();
      const socketClosed = new Promise<void>((resolveClose) => socket.once('close', () => resolveClose()));
      stopping = server.close();
      const concurrentStopping = server.close();
      await vi.advanceTimersByTimeAsync(viewerServerCloseGracePeriodMs);

      // Then: the server-owned incomplete connection is forcibly closed and terminal close settles.
      expect(concurrentStopping).toBe(stopping);
      await expect(stopping).resolves.toBeUndefined();
      await expect(socketClosed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
      socket.destroy();
      if (stopping) {
        await stopping;
      } else {
        await server.close();
      }
      servers.splice(servers.indexOf(server), 1);
    }
  });
});
