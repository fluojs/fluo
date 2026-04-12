import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { Controller, FromBody, Get, Post, RequestDto } from '@fluojs/http';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import {
  bootstrapNodeApplication,
  runNodeApplication,
} from '@fluojs/runtime/node';

import {
  bootstrapNodejsApplication,
  createNodejsAdapter,
  runNodejsApplication,
} from './index.js';
import * as platformNodejsApi from './index.js';

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve an available port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

describe('@fluojs/platform-nodejs', () => {
  it('re-exports the existing Node compatibility helpers through the platform package', () => {
    expect(bootstrapNodejsApplication).toBe(bootstrapNodeApplication);
    expect(runNodejsApplication).toBe(runNodeApplication);
  });

  it('keeps advanced process and compression utilities off the primary platform startup surface', () => {
    expect(platformNodejsApi).not.toHaveProperty('compressNodeResponse');
    expect(platformNodejsApi).not.toHaveProperty('createNodeResponseCompression');
    expect(platformNodejsApi).not.toHaveProperty('createNodeShutdownSignalRegistration');
    expect(platformNodejsApi).not.toHaveProperty('registerShutdownSignals');
  });

  it('supports adapter-first startup on the runtime facade for raw Node', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { status: 'ok' };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [HealthController] });

    const port = await findAvailablePort();
    const app = await FluoFactory.create(AppModule, {
      adapter: createNodejsAdapter({ port }),
    });

    try {
      await app.listen();

      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('exposes a server-backed realtime capability on the raw Node adapter', async () => {
    const adapter = createNodejsAdapter();

    try {
      expect(adapter.getRealtimeCapability?.()).toEqual({
        kind: 'server-backed',
        server: adapter.getServer(),
      });
    } finally {
      await adapter.close();
    }
  });

  it('returns 413 when raw Node request bodies exceed maxBodySize', async () => {
    class EchoBody {
      @FromBody()
      value!: string;
    }

    @Controller('/echo')
    class EchoController {
      @Post('/')
      @RequestDto(EchoBody)
      echo(input: EchoBody) {
        return input.value;
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [EchoController] });

    const port = await findAvailablePort();
    const app = await FluoFactory.create(AppModule, {
      adapter: createNodejsAdapter({ maxBodySize: 8, port }),
    });

    try {
      await app.listen();

      const response = await fetch(`http://127.0.0.1:${String(port)}/echo`, {
        body: '0123456789',
        headers: {
          'content-type': 'text/plain',
        },
        method: 'POST',
      });

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          message: 'Request body exceeds the size limit.',
          status: 413,
        },
      });
    } finally {
      await app.close();
    }
  });
});
