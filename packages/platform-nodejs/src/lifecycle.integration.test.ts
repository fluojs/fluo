import { Agent, get, request, Server, type InformationEvent } from 'node:http';
import type { Socket } from 'node:net';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { bootstrapNodejsApplication, createNodejsAdapter } from './index.js';

async function requestWithEarlyHints(url: string): Promise<{
  readonly body: string;
  readonly finalLink: string | string[] | undefined;
  readonly informational: readonly InformationEvent[];
  readonly statusCode: number;
}> {
  return await new Promise((resolve, reject) => {
    const informational: InformationEvent[] = [];
    const clientRequest = request(url, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.once('error', reject);
      response.once('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          finalLink: response.headers.link,
          informational,
          statusCode: response.statusCode ?? 0,
        });
      });
    });

    clientRequest.on('information', (information) => {
      informational.push(information);
    });
    clientRequest.once('error', reject);
    clientRequest.end();
  });
}

describe('@fluojs/platform-nodejs lifecycle integration', () => {
  it('emits multiple Early Hints before an independent final response on a real listener', async () => {
    @Controller('/early-hints')
    class EarlyHintsController {
      @Get('/')
      async render(_input: undefined, context: RequestContext) {
        const earlyHints = context.response.earlyHints;

        if (!earlyHints) {
          throw new Error('Expected the Node.js response to support Early Hints.');
        }

        await earlyHints.write({
          link: '</styles.css>; rel=preload; as=style',
          'x-early-trace': 'first',
        });
        await earlyHints.write({
          link: '</app.js>; rel=modulepreload',
        });
        context.response.setHeader('link', '</final.css>; rel=stylesheet');

        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [EarlyHintsController] });

    const adapter = createNodejsAdapter({ host: '127.0.0.1', port: 0 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();
      const response = await requestWithEarlyHints(`${adapter.getListenTarget().url}/early-hints`);

      expect(response.informational.map(({ headers, statusCode }) => ({
        link: headers.link,
        statusCode,
        trace: headers['x-early-trace'],
      }))).toEqual([
        {
          link: '</styles.css>; rel=preload; as=style',
          statusCode: 103,
          trace: 'first',
        },
        {
          link: '</app.js>; rel=modulepreload',
          statusCode: 103,
          trace: undefined,
        },
      ]);
      expect(response.statusCode).toBe(200);
      expect(response.finalLink).toBe('</final.css>; rel=stylesheet');
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

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
