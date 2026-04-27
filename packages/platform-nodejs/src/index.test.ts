import { createServer } from 'node:net';
import { Controller, FromBody, Get, Post, RequestDto } from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import {
  type BootstrapNodeApplicationOptions,
  bootstrapNodeApplication,
  type NodeApplicationSignal,
  type NodeHttpAdapterOptions,
  type NodeHttpApplicationAdapter,
  type RunNodeApplicationOptions,
  runNodeApplication,
} from '@fluojs/runtime/node';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as platformNodejsApi from './index.js';
import {
  type BootstrapNodejsApplicationOptions,
  bootstrapNodejsApplication,
  createNodejsAdapter,
  type NodejsAdapterOptions,
  type NodejsApplicationSignal,
  type NodejsHttpApplicationAdapter,
  type RunNodejsApplicationOptions,
  runNodejsApplication,
} from './index.js';

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

  it('keeps the documented runtime value surface focused on Node.js startup helpers', () => {
    expect(Object.keys(platformNodejsApi).sort()).toEqual([
      'bootstrapNodejsApplication',
      'createNodejsAdapter',
      'runNodejsApplication',
    ]);
  });

  it('keeps the documented Node.js type aliases aligned with the runtime adapter surface', () => {
    expectTypeOf<BootstrapNodejsApplicationOptions>().toEqualTypeOf<BootstrapNodeApplicationOptions>();
    expectTypeOf<NodejsAdapterOptions>().toEqualTypeOf<NodeHttpAdapterOptions>();
    expectTypeOf<NodejsApplicationSignal>().toEqualTypeOf<NodeApplicationSignal>();
    expectTypeOf<NodejsHttpApplicationAdapter>().toEqualTypeOf<NodeHttpApplicationAdapter>();
    expectTypeOf<RunNodejsApplicationOptions>().toEqualTypeOf<RunNodeApplicationOptions>();
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
