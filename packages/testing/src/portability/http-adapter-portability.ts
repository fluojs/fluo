import { createServer } from 'node:net';
import { request as httpsRequest } from 'node:https';

import {
  Controller,
  Get,
  Post,
  SseResponse,
  type RequestContext,
} from '@fluojs/http';
import {
  defineModule,
  type ApplicationLogger,
  type ModuleType,
  type UploadedFile,
} from '@fluojs/runtime';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

type AppLike = {
  close(): Promise<void>;
  listen(): Promise<void>;
};

/**
 * Options for configuring the HTTP adapter portability harness.
 *
 * @template TBootstrapOptions - Type for bootstrap-specific options.
 * @template TRunOptions - Type for run-specific options.
 * @template TApp - Type for the application instance.
 */
export interface HttpAdapterPortabilityHarnessOptions<
  TBootstrapOptions extends object,
  TRunOptions extends object,
  TApp extends AppLike = AppLike,
> {
  /**
   * Function to bootstrap the application with the given root module and options.
   *
   * @param rootModule - The root module of the application.
   * @param options - The bootstrap options.
   * @returns A promise that resolves to the application instance.
   */
  bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;

  /**
   * Optional adapter-specific content type used by the exact-byte raw-body portability assertion.
   */
  exactRawBodyByteContentType?: string;

  /**
   * Optional adapter-specific preparation used before the exact-byte raw-body portability assertion.
   */
  prepareExactRawBodyByteTest?: (app: TApp) => void | Promise<void>;

  /**
   * The name of the adapter being tested.
   */
  name: string;

  /**
   * Function to run the application with the given root module and options.
   *
   * @param rootModule - The root module of the application.
   * @param options - The run options.
   * @returns A promise that resolves to the application instance.
   */
  run: (rootModule: ModuleType, options: TRunOptions) => Promise<TApp>;
}

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

async function requestHttps(url: string): Promise<{ body: string; statusCode: number }> {
  return await new Promise((resolve, reject) => {
    const request = httpsRequest(url, { rejectUnauthorized: false }, (response) => {
      const chunks: Buffer[] = [];

      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          statusCode: response.statusCode ?? 0,
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

async function closeSilently(app: AppLike): Promise<void> {
  try {
    await app.close();
  } catch {}
}

/**
 * A portability harness for testing HTTP adapters to ensure they behave
 * consistently across different environments.
 *
 * @template TBootstrapOptions - Type for bootstrap-specific options.
 * @template TRunOptions - Type for run-specific options.
 * @template TApp - Type for the application instance.
 */
export class HttpAdapterPortabilityHarness<
  TBootstrapOptions extends object,
  TRunOptions extends object,
  TApp extends AppLike = AppLike,
> {
  /**
   * Creates a new instance of the {@link HttpAdapterPortabilityHarness}.
   *
   * @param options - Configuration options for the harness.
   */
  constructor(private readonly options: HttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TRunOptions, TApp>) {}

  /**
   * Asserts that the adapter preserves malformed cookie values without crashing
   * or incorrectly normalizing them.
   */
  async assertPreservesMalformedCookieValues(): Promise<void> {
    @Controller('/cookies')
    class CookieController {
      @Get('/')
      readCookies(_input: undefined, context: RequestContext) {
        return context.request.cookies;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CookieController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port } as TBootstrapOptions);

    await app.listen();

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/cookies`, {
        headers: {
          cookie: 'good=hello%20world; bad=%E0%A4%A',
        },
      });

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed malformed-cookie handling: expected 200 but received ${String(response.status)}.`);
      }

      const body = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('bad' in body) ||
        !('good' in body) ||
        (body as Record<string, unknown>).bad !== '%E0%A4%A' ||
        (body as Record<string, unknown>).good !== 'hello world' ||
        Object.keys(body as Record<string, unknown>).length !== 2
      ) {
        throw new Error(`${this.options.name} adapter changed malformed-cookie normalization.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertPreservesRawBodyForJsonAndText(): Promise<void> {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/json')
      handleJson(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
        };
      }

      @Post('/text')
      handleText(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port, rawBody: true } as TBootstrapOptions);

    await app.listen();

    try {
      const [jsonResponse, textResponse] = await Promise.all([
        fetch(`http://127.0.0.1:${String(port)}/webhooks/json`, {
          body: JSON.stringify({ provider: 'stripe' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
        fetch(`http://127.0.0.1:${String(port)}/webhooks/text`, {
          body: 'ping=1',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          method: 'POST',
        }),
      ]);

      if (jsonResponse.status !== 201 || textResponse.status !== 201) {
        throw new Error(`${this.options.name} adapter changed rawBody response status semantics.`);
      }

      const [jsonBody, textBody] = await Promise.all([jsonResponse.json(), textResponse.json()]);

      if (JSON.stringify(jsonBody) !== JSON.stringify({ parsed: { provider: 'stripe' }, raw: '{"provider":"stripe"}' })) {
        throw new Error(`${this.options.name} adapter changed JSON rawBody semantics.`);
      }

      if (JSON.stringify(textBody) !== JSON.stringify({ parsed: 'ping=1', raw: 'ping=1' })) {
        throw new Error(`${this.options.name} adapter changed text rawBody semantics.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertPreservesExactRawBodyBytesForByteSensitivePayloads(): Promise<void> {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/bytes')
      handleBytes(_input: undefined, context: RequestContext) {
        return {
          rawBytes: Array.from(context.request.rawBody ?? new Uint8Array()),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port, rawBody: true } as TBootstrapOptions);

    await this.options.prepareExactRawBodyByteTest?.(app);

    await app.listen();

    try {
      const payload = Uint8Array.from([0xe9, 0x41]);
      const contentType = this.options.exactRawBodyByteContentType ?? 'text/plain; charset=latin1';
      const response = await fetch(`http://127.0.0.1:${String(port)}/webhooks/bytes`, {
        body: payload,
        headers: { 'content-type': contentType },
        method: 'POST',
      });

      if (response.status !== 201) {
        throw new Error(`${this.options.name} adapter changed byte-sensitive rawBody response status semantics.`);
      }

      const body = await response.json();
      if (JSON.stringify(body) !== JSON.stringify({ rawBytes: Array.from(payload) })) {
        throw new Error(`${this.options.name} adapter changed exact-byte rawBody semantics.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertExcludesRawBodyForMultipart(): Promise<void> {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
          fileCount: context.request.files?.length ?? 0,
          hasRawBody: context.request.rawBody !== undefined,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port, rawBody: true } as TBootstrapOptions);

    await app.listen();

    try {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const response = await fetch(`http://127.0.0.1:${String(port)}/uploads`, {
        body: form,
        method: 'POST',
      });

      if (response.status !== 201) {
        throw new Error(`${this.options.name} adapter changed multipart response status semantics.`);
      }

      const body = await response.json();
      if (JSON.stringify(body) !== JSON.stringify({ body: { name: 'Ada' }, fileCount: 1, hasRawBody: false })) {
        throw new Error(`${this.options.name} adapter changed multipart rawBody semantics.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertDefaultsMultipartTotalLimitToMaxBodySize(): Promise<void> {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        return {
          body: context.request.body,
          fileCount: context.request.files?.length ?? 0,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      maxBodySize: 8,
      multipart: {
        maxFileSize: 1024,
      },
      port,
    } as TBootstrapOptions);

    await app.listen();

    try {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['12345678'], { type: 'text/plain' }), 'payload.txt');

      const response = await fetch(`http://127.0.0.1:${String(port)}/uploads`, {
        body: form,
        method: 'POST',
      });

      if (response.status !== 413) {
        throw new Error(`${this.options.name} adapter did not default multipart.maxTotalSize to maxBodySize.`);
      }

      const body = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        (body as { error?: { code?: unknown } }).error?.code !== 'PAYLOAD_TOO_LARGE'
      ) {
        throw new Error(`${this.options.name} adapter changed multipart limit error semantics.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertSupportsSseStreaming(): Promise<void> {
    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);

        stream.comment('connected');
        stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
        setTimeout(() => {
          stream.close();
        }, 10);

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port } as TBootstrapOptions);

    await app.listen();

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
        headers: { accept: 'text/event-stream' },
      });
      const body = await response.text();

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed SSE response status semantics.`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/event-stream')) {
        throw new Error(`${this.options.name} adapter does not expose text/event-stream content-type.`);
      }

      if (!body.includes('event: ready') || !body.includes('data: {"ready":true}')) {
        throw new Error(`${this.options.name} adapter changed SSE body framing.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  /**
   * Asserts that adapter stream backpressure waiters settle when the response
   * closes before a `drain` event is emitted.
   */
  async assertSettlesStreamDrainWaitOnClose(): Promise<void> {
    const adapterName = this.options.name;
    let resolveDrainWait!: () => void;
    const drainWaitSettled = new Promise<void>((resolve) => {
      resolveDrainWait = resolve;
    });

    @Controller('/events')
    class EventsController {
      @Get('/')
      async stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);
        const responseStream = context.response.stream;

        if (!responseStream?.waitForDrain) {
          throw new Error(`${adapterName} adapter did not expose response.stream.waitForDrain().`);
        }

        const drainWait = responseStream.waitForDrain();
        stream.close();
        await drainWait;
        resolveDrainWait();

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const port = await findAvailablePort();
    const app = await this.options.bootstrap(AppModule, { cors: false, port } as TBootstrapOptions);

    await app.listen();

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
        headers: { accept: 'text/event-stream' },
      });

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed closed stream response status semantics.`);
      }

      await response.text();
      await withTimeout(drainWaitSettled, 2_000, `${this.options.name} adapter left response.stream.waitForDrain() pending after close.`);
    } finally {
      await closeSilently(app);
    }
  }

  async assertReportsConfiguredHostInStartupLogs(): Promise<void> {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const port = await findAvailablePort();
    const app = await this.options.run(AppModule, {
      cors: false,
      host: '127.0.0.1',
      logger,
      port,
    } as TRunOptions);

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed host-bound health response semantics.`);
      }

      const body = await response.json();
      if (JSON.stringify(body) !== JSON.stringify({ ok: true })) {
        throw new Error(`${this.options.name} adapter changed host-bound response payload.`);
      }

      const expectedLog = `log:FluoFactory:Listening on http://127.0.0.1:${String(port)}`;
      if (!loggerEvents.includes(expectedLog)) {
        throw new Error(`${this.options.name} adapter changed startup host logging.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertReportsHttpsStartupUrl(https: { cert: string; key: string }): Promise<void> {
    const loggerEvents: string[] = [];
    const logger: ApplicationLogger = {
      debug() {},
      error(message: string, error: unknown, context?: string) {
        loggerEvents.push(`error:${context}:${message}:${error instanceof Error ? error.message : 'none'}`);
      },
      log(message: string, context?: string) {
        loggerEvents.push(`log:${context}:${message}`);
      },
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const port = await findAvailablePort();
    const app = await this.options.run(AppModule, {
      cors: false,
      host: '127.0.0.1',
      https,
      logger,
      port,
    } as TRunOptions);

    try {
      const response = await requestHttps(`https://127.0.0.1:${String(port)}/health`);

      if (response.statusCode !== 200) {
        throw new Error(`${this.options.name} adapter changed HTTPS response status semantics.`);
      }

      if (JSON.stringify(JSON.parse(response.body)) !== JSON.stringify({ ok: true })) {
        throw new Error(`${this.options.name} adapter changed HTTPS response payload semantics.`);
      }

      const expectedLog = `log:FluoFactory:Listening on https://127.0.0.1:${String(port)}`;
      if (!loggerEvents.includes(expectedLog)) {
        throw new Error(`${this.options.name} adapter changed HTTPS startup logging.`);
      }
    } finally {
      await closeSilently(app);
    }
  }

  async assertRemovesShutdownSignalListenersAfterClose(): Promise<void> {
    const logger: ApplicationLogger = {
      debug() {},
      error() {},
      log() {},
      warn() {},
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const signal = 'SIGTERM' as const;
    const listenersBefore = process.listeners(signal).length;
    const port = await findAvailablePort();
    const app = await this.options.run(AppModule, {
      cors: false,
      logger,
      port,
      shutdownSignals: [signal],
    } as TRunOptions);

    try {
      if (process.listeners(signal).length !== listenersBefore + 1) {
        throw new Error(`${this.options.name} adapter did not register the expected shutdown listener.`);
      }
    } finally {
      await closeSilently(app);
    }

    if (process.listeners(signal).length !== listenersBefore) {
      throw new Error(`${this.options.name} adapter leaked shutdown signal listeners after close().`);
    }
  }
}

/**
 * Creates a new {@link HttpAdapterPortabilityHarness} instance with the provided options.
 *
 * @template TBootstrapOptions - Type for bootstrap-specific options.
 * @template TRunOptions - Type for run-specific options.
 * @template TApp - Type for the application instance.
 * @param options - Configuration options for the harness.
 * @returns A new portability harness instance.
 */
export function createHttpAdapterPortabilityHarness<
  TBootstrapOptions extends object,
  TRunOptions extends object,
  TApp extends AppLike = AppLike,
>(
  options: HttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TRunOptions, TApp>,
): HttpAdapterPortabilityHarness<TBootstrapOptions, TRunOptions, TApp> {
  return new HttpAdapterPortabilityHarness(options);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return await Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
