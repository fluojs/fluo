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
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/http-adapter-portability';
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

const TEST_TLS_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDBbj6DdMPNvDMr
yNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4PEgAic+840rq
tyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEBC7IWph1sKGcC
iRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk7/3R0hqkiF5x
k/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCyuW/sQMYSglan
T2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5sGM/bE4y3pgj2
kQXpbdUnAgMBAAECggEAT8yIc7kPMmgrACw5YLGOxuhbqb3/51r+s1PIC9/B14IQ
VCejxsrejp6EGe6tBZZmOu47kiVIk5d9h7mIsIZTJDnTQjLOtGTfXTYb3nldFdqJ
exoa3JnCr18FFhIGbAinSUQm81sSllVQseYYy9xnOMqFAv27lFTZwKr3yUEtvJ9h
oYqq5/yRNwwR1AT6lfWgSJa5S9cvs9YHK4k2XCnhKTqWkQ3Bh9awKy83142r1FWy
rXk3IUwNaNAgRHSEw/9MGbcM6it+l55XjwzEBP/lI+DdDzhRhKgp3QsM/v26eHRl
CwP0NA4d4i1m2kcT8dvtSTxrnwbylSxhVRDYXrsOMQKBgQDn+f9I9LlQJdGPWRda
0YiyZtQZTGYfG/ZJvHPvhLA37rAfV7MGDqKgn22FJPJHT9vE+wVkUT531VErKKlO
dOv6GIz/C3AolVTOTDKxTZnFkicxy4J7pZYHPRo8mIVGFlsKsPQVPz63UZMUkbR6
0HkgcihnxKKlYFb+az7hNvPZbwKBgQDVdlglrw9jGreXtGplZLapsTmAc+GuL17R
fqY4/aXNul0k6MNlSrm2/cUm/KI8AsHvRn2tvdFJnM1drmzEpTvcFx5a9N2F5HOU
N1smlv31RT5B0XqoHTB7df2+zVeAGGcpDY8n27KI9/zigVdVQR/aR+fR7CFfNhCv
sI8PQUkzyQKBgQDWKHckjEF0m6VuuGoWPvD6+nF+9Ygl2jOyeRdzHUVuLZ5NITK2
OdargOOkEqrVaQVUQgYFSffou3eW54/+TXT5S6cHYjDmVo6XccMu6pw2yKoEj4Pj
0MfD4QYSwR/wx3y/TwPXha7JoLavO6Cp7UKV0K46tk8Na/aEJNBFLO1MYwKBgElV
jfTsTnn6rMYmikLpNcPYieuyY/8GcSnBu/NqWLLz6poKiU5cPK88QaYiNs4tGFlO
u1CcHLGQeBFOIjnwlj8HhjszUoN0N6zc06jPSNIhhsDv6Zal6IkRwSnyu7PbLl2x
NdQ4qv5ZS/y4+LrmU74W4/J/j/t4xITHQG66PB7ZAoGANNL4daB3T46IElDHnCbl
j4hWQezWEMRCf4Ruqy24peC4Y8CXMaGA0oN6auePuTdLmGYa9nDn0J77rMqLIG7+
v8OLobYRGfklwPOBs5puVFTEgihMq7Ejh2r9HhoRiCAZS5hIirS08BgrAskgVw9P
dM+3fSZauOH3r+7JXAvrtMo=
-----END PRIVATE KEY-----`;

const TEST_TLS_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQCAEWnETUdMHDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAkx
MjcuMC4wLjEwHhcNMjYwMzE4MDEzNTQ2WhcNMjYwMzE5MDEzNTQ2WjAUMRIwEAYD
VQQDDAkxMjcuMC4wLjEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDB
bj6DdMPNvDMryNUM0dreceSBINfH+VDV750R3X57mdoqebUgjKOXjbjR7JRkloJ4
PEgAic+840rqtyTN/MvmaAQg5OtNwsY7wp3Owaomr0sqw+wHM7NkPYMB0apxcWEB
C7IWph1sKGcCiRxNDBBMEUmhxscatvhfkB/aqlQxLYjDylFcIX0A3NzIW0Rfaydk
7/3R0hqkiF5xk/98U2cEPZn1E890q4IsfQ6mGMNi/fh1jMWiR5RFL9MlIhLEJPCy
uW/sQMYSglanT2sKcABWjIShAc4gn87ncbmSv/6IDgfXtVRD6mehvFz9iHVSbV5s
GM/bE4y3pgj2kQXpbdUnAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAJhOoDgzUsiV
XE0p5DznahRbv85K05BS6iXfMRnjgHziJyED0h6dD3vpFTnQLW9I7SQeMA21sZPx
MNm+gL8/Jq2G2CGwx0naD9bsTFYboWhBk+SuQVj8f7g8xM7ya2nB8AJg07/n3VD5
NJFlJnyXlpchaxikKeaLWWGJCzPosbqUDdS5Y9S3VkqxM3na4Z+04qLaLQSEEpSi
WZWkDdOMceoMbJC0CpyVtWCW7mKKFOwL/yEtmJ0Uw0aaHwFOEj9+FQUPYjThCcbz
fHFvqyh6pXZV7XKcPxCTNuIw2rpw2WqY5/H+lTmUFmSXieFZAAMRueGH8Y5trCHU
JNCDpGwh8us=
-----END CERTIFICATE-----`;

const nodejsPortabilityHarness = createHttpAdapterPortabilityHarness<
  BootstrapNodejsApplicationOptions,
  RunNodejsApplicationOptions
>({
  bootstrap: bootstrapNodejsApplication,
  name: 'nodejs',
  run: runNodejsApplication,
});

describe('@fluojs/platform-nodejs', () => {
  describe('adapter portability', () => {
    it('preserves malformed cookie values', async () => {
      await nodejsPortabilityHarness.assertPreservesMalformedCookieValues();
    });

    it('preserves raw body for JSON and text requests when enabled', async () => {
      await nodejsPortabilityHarness.assertPreservesRawBodyForJsonAndText();
    });

    it('preserves exact raw body bytes for byte-sensitive payloads', async () => {
      await nodejsPortabilityHarness.assertPreservesExactRawBodyBytesForByteSensitivePayloads();
    });

    it('does not preserve rawBody for multipart requests', async () => {
      await nodejsPortabilityHarness.assertExcludesRawBodyForMultipart();
    });

    it('defaults multipart.maxTotalSize to maxBodySize', async () => {
      await nodejsPortabilityHarness.assertDefaultsMultipartTotalLimitToMaxBodySize();
    });

    it('supports SSE streaming', async () => {
      await nodejsPortabilityHarness.assertSupportsSseStreaming();
    });

    it('settles stream drain waits when the stream closes first', async () => {
      await nodejsPortabilityHarness.assertSettlesStreamDrainWaitOnClose();
    });

    it('reports the configured host in startup logs', async () => {
      await nodejsPortabilityHarness.assertReportsConfiguredHostInStartupLogs();
    });

    it('supports https startup and reports the https listen URL', async () => {
      await nodejsPortabilityHarness.assertReportsHttpsStartupUrl({
        cert: TEST_TLS_CERTIFICATE,
        key: TEST_TLS_PRIVATE_KEY,
      });
    });

    it('removes registered shutdown signal listeners after close', async () => {
      await nodejsPortabilityHarness.assertRemovesShutdownSignalListenersAfterClose();
    });
  });

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

  it('removes registered shutdown signal listeners after close through the platform run helper', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [HealthController] });

    const signal = 'SIGTERM' as const;
    const listenersBefore = new Set(process.listeners(signal));
    const port = await findAvailablePort();
    const app = await runNodejsApplication(AppModule, {
      logger: {
        debug() {},
        error() {},
        log() {},
        warn() {},
      },
      port,
      shutdownSignals: [signal],
    });
    const registeredListeners = process.listeners(signal).filter((listener) => !listenersBefore.has(listener));

    try {
      expect(registeredListeners.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }

    for (const listener of registeredListeners) {
      expect(process.listeners(signal)).not.toContain(listener);
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
      @Post('/raw')
      raw(_input: undefined, context: RequestContext) {
        return context.request.body;
      }

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

      const boundaryResponse = await fetch(`http://127.0.0.1:${String(port)}/echo/raw`, {
        body: '12345678',
        headers: {
          'content-type': 'text/plain',
        },
        method: 'POST',
      });

      expect(boundaryResponse.status).toBe(201);
      await expect(boundaryResponse.text()).resolves.toBe('12345678');

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
