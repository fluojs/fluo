import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { Controller, Get } from '@konekti/http';
import { KonektiFactory, defineModule } from '@konekti/runtime';
import {
  bootstrapNodeApplication,
  runNodeApplication,
} from '@konekti/runtime/node';

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

describe('@konekti/platform-nodejs', () => {
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
    const app = await KonektiFactory.create(AppModule, {
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
});
