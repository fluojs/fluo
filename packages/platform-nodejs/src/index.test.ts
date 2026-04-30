import { createServer } from 'node:net';
import { Controller, FromBody, Get, Post, RequestDto, type RequestContext } from '@fluojs/http';
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

type MultipartRequestWithFiles = RequestContext['request'] & {
  files?: Array<{
    fieldname: string;
    mimetype: string;
    originalname: string;
    size: number;
  }>;
};

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

  it('preserves benchmark-style simple query and JSON body routes through the public Node adapter path', async () => {
    @Controller('/')
    class BenchmarkController {
      @Get('/query-one')
      readQuery(_input: undefined, context: RequestContext) {
        return {
          encoded: context.request.query.encoded,
          tag: context.request.query.tag,
        };
      }

      @Post('/body-one')
      readBody(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [BenchmarkController] });

    const port = await findAvailablePort();
    const app = await FluoFactory.create(AppModule, {
      adapter: createNodejsAdapter({ port }),
    });

    try {
      await app.listen();

      const queryResponse = await fetch(`http://127.0.0.1:${String(port)}/query-one?tag=one&tag=two&encoded=hello+world`);

      expect(queryResponse.status).toBe(200);
      await expect(queryResponse.json()).resolves.toEqual({
        encoded: 'hello world',
        tag: ['one', 'two'],
      });

      const bodyResponse = await fetch(`http://127.0.0.1:${String(port)}/body-one`, {
        body: JSON.stringify({ ok: true, source: 'node' }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      expect(bodyResponse.status).toBe(201);
      await expect(bodyResponse.json()).resolves.toEqual({
        body: { ok: true, source: 'node' },
      });
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

  it('parses mixed-case JSON content-type headers through the public Node adapter request path', async () => {
    class JsonBody {
      @FromBody()
      ok!: boolean;
    }

    @Controller('/echo')
    class EchoController {
      @Post('/json')
      @RequestDto(JsonBody)
      echo(input: JsonBody, ctx: RequestContext) {
        return {
          dto: input,
          requestBody: ctx.request.body,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [EchoController] });

    const port = await findAvailablePort();
    const app = await FluoFactory.create(AppModule, {
      adapter: createNodejsAdapter({ port }),
    });

    try {
      await app.listen();

      const response = await fetch(`http://127.0.0.1:${String(port)}/echo/json`, {
        body: JSON.stringify({ ok: true }),
        headers: {
          'content-type': 'Application/Json; Charset=UTF-8',
        },
        method: 'POST',
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        dto: { ok: true },
        requestBody: { ok: true },
      });
    } finally {
      await app.close();
    }
  });

  it('parses mixed-case multipart content-type headers through the public Node adapter request path', async () => {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, ctx: RequestContext) {
        const request = ctx.request as MultipartRequestWithFiles;

        return {
          body: ctx.request.body,
          files: request.files?.map((file: NonNullable<MultipartRequestWithFiles['files']>[number]) => ({
            fieldname: file.fieldname,
            mimetype: file.mimetype,
            originalname: file.originalname,
            size: file.size,
          })) ?? [],
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UploadController] });

    const port = await findAvailablePort();
    const app = await FluoFactory.create(AppModule, {
      adapter: createNodejsAdapter({ port }),
    });

    try {
      await app.listen();

      const form = new FormData();
      form.append('name', 'Ada');
      form.append('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const request = new Request(`http://127.0.0.1:${String(port)}/uploads`, {
        body: form,
        method: 'POST',
      });
      const response = await fetch(request.url, {
        body: await request.arrayBuffer(),
        headers: {
          'content-type': request.headers
            .get('content-type')
            ?.replace('multipart/form-data', 'Multipart/Form-Data') ?? '',
        },
        method: request.method,
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        body: { name: 'Ada' },
        files: [
          {
            fieldname: 'payload',
            mimetype: 'text/plain',
            originalname: 'payload.txt',
            size: 5,
          },
        ],
      });
    } finally {
      await app.close();
    }
  });
});
