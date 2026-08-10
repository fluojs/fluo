import { Agent, get, Server } from 'node:http';
import type { Socket } from 'node:net';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { bootstrapNodejsApplication, createNodejsAdapter } from './index.js';

describe('@fluojs/platform-nodejs lifecycle integration', () => {
  it('binds only when app.listen() is called after bootstrap', async () => {
    // Given: a bootstrapped application using an OS-assigned port.
    class AppModule {}
    defineModule(AppModule, {});

    const app = await bootstrapNodejsApplication(AppModule, {
      host: '127.0.0.1',
      port: 0,
    });

    try {
      const adapter: unknown = Reflect.get(app, 'adapter');
      if (
        typeof adapter !== 'object'
        || adapter === null
        || !('getServer' in adapter)
        || typeof adapter.getServer !== 'function'
      ) {
        throw new Error('Expected bootstrapNodejsApplication() to own a Node.js server adapter.');
      }

      const server = adapter.getServer();
      if (!(server instanceof Server)) {
        throw new Error('Expected the bootstrapped Node.js adapter to expose its HTTP server.');
      }

      expect(server.address()).toBeNull();
      expect(server.listening).toBe(false);

      // When: the caller explicitly starts the application.
      await app.listen();

      // Then: the adapter owns a live listener only after that call.
      expect(server.address()).not.toBeNull();
      expect(server.listening).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('releases a real idle keep-alive socket when the application closes', async () => {
    // Given: a live application and a client socket returned to a keep-alive agent.
    class AppModule {}
    defineModule(AppModule, {});

    const adapter = createNodejsAdapter({
      host: '127.0.0.1',
      port: 0,
      shutdownTimeoutMs: 1_000,
    });
    const app = await FluoFactory.create(AppModule, { adapter });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    let idleListener: ((socket: Socket) => void) | undefined;
    let waitTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await app.listen();
      const idleSocket = new Promise<Socket>((resolve, reject) => {
        const onFree = (socket: Socket) => {
          if (waitTimeout) {
            clearTimeout(waitTimeout);
            waitTimeout = undefined;
          }
          idleListener = undefined;
          resolve(socket);
        };

        idleListener = onFree;
        agent.once('free', onFree);
        waitTimeout = setTimeout(() => {
          agent.off('free', onFree);
          idleListener = undefined;
          waitTimeout = undefined;
          reject(new Error('Timed out waiting for a real idle keep-alive socket.'));
        }, 1_000);
      });

      const requestCompleted = new Promise<void>((resolve, reject) => {
        const request = get(`${adapter.getListenTarget().url}/idle`, { agent }, (response) => {
          response.once('error', reject);
          response.once('end', resolve);
          response.resume();
        });
        request.once('error', reject);
      });

      const [socket] = await Promise.all([idleSocket, requestCompleted]);
      expect(socket.destroyed).toBe(false);
      expect(Object.values(agent.freeSockets).some((sockets) => sockets?.includes(socket) === true)).toBe(true);

      const socketClosed = new Promise<void>((resolve, reject) => {
        const onClose = () => {
          if (waitTimeout) {
            clearTimeout(waitTimeout);
            waitTimeout = undefined;
          }
          resolve();
        };

        socket.once('close', onClose);
        waitTimeout = setTimeout(() => {
          socket.off('close', onClose);
          waitTimeout = undefined;
          reject(new Error('Timed out waiting for the idle keep-alive socket to close.'));
        }, 1_000);
      });

      // When: application shutdown closes the Node.js adapter.
      await app.close();

      // Then: the already-idle client socket observes transport closure.
      await socketClosed;
      expect(socket.destroyed).toBe(true);
    } finally {
      if (idleListener) {
        agent.off('free', idleListener);
      }
      if (waitTimeout) {
        clearTimeout(waitTimeout);
      }
      agent.destroy();
      await app.close();
    }
  });
});
