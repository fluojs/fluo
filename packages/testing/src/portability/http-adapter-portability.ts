import {
  Controller,
  type ContentNegotiationOptions,
  Get,
  Head,
  Post,
  Produces,
  Query,
  type ConditionalRequestOptions,
  type RequestContext,
  Route,
  SseResponse,
} from '@fluojs/http';
import { type ApplicationLogger, defineModule, type ModuleType } from '@fluojs/runtime';
import { assertNetworkHttpErrorRepresentationAbortPortability } from './error-representation-abort-portability.js';
import {
  assertNetworkHttpErrorRepresentationPortability,
  type NetworkHttpErrorRepresentationBootstrapOptions,
} from './error-representation-portability.js';
import {
  assertPortableResponseCookies,
  createResponseCookiePortabilityModule,
} from './response-cookie-portability.js';

export type { NetworkHttpErrorRepresentationBootstrapOptions } from './error-representation-portability.js';

type AppLike = {
  close(): Promise<void>;
  listen(): Promise<void>;
};

type ListenTargetLike = {
  url: string;
};

type AdapterWithListenTarget = {
  getListenTarget(): ListenTargetLike;
};

type RunRejectionWithApp = {
  app: AppLike;
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

  /** Adapts the shared error-representation fixture fields to this adapter's bootstrap options. */
  createErrorRepresentationBootstrapOptions?: (
    options: NetworkHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;

  /** Adapts shared conditional-request policy options to one listener bootstrap API. */
  createConditionalRequestBootstrapOptions?: (
    options: {
      readonly conditionalRequest: ConditionalRequestOptions;
      readonly contentNegotiation: ContentNegotiationOptions;
      readonly cors: false;
      readonly port: 0;
    },
  ) => TBootstrapOptions;

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

function hasListenTarget(value: unknown): value is AdapterWithListenTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getListenTarget' in value &&
    typeof value.getListenTarget === 'function'
  );
}

function hasRejectedApp(value: unknown): value is RunRejectionWithApp {
  if (typeof value !== 'object' || value === null || !('app' in value)) {
    return false;
  }

  const app = Reflect.get(value, 'app');
  return (
    typeof app === 'object' &&
    app !== null &&
    'close' in app &&
    typeof Reflect.get(app, 'close') === 'function' &&
    'listen' in app &&
    typeof Reflect.get(app, 'listen') === 'function'
  );
}

function resolveListeningUrl(app: AppLike, adapterName: string): string {
  const adapter = Reflect.get(app, 'adapter');

  if (!hasListenTarget(adapter)) {
    throw new Error(`${adapterName} adapter portability harness cannot resolve the listener URL after binding port 0.`);
  }

  const target = adapter.getListenTarget();
  if (typeof target.url !== 'string' || target.url.length === 0) {
    throw new Error(`${adapterName} adapter portability harness resolved an empty listener URL after binding port 0.`);
  }

  return target.url;
}

async function requestHttps(url: string): Promise<{ body: string; statusCode: number }> {
  const [{ Buffer }, { request: httpsRequest }] = await Promise.all([
    import('node:buffer'),
    import('node:https'),
  ]);

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

async function requestCustomHttpMethod(
  url: string,
  method: string,
  body: string,
): Promise<{ body: string; statusCode: number }> {
  const [{ Buffer }, { request: httpRequest }] = await Promise.all([
    import('node:buffer'),
    import('node:http'),
  ]);
  const target = new URL(url);
  const hostname = target.hostname.startsWith('[') && target.hostname.endsWith(']')
    ? target.hostname.slice(1, -1)
    : target.hostname;

  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      headers: {
        'content-length': String(Buffer.byteLength(body)),
        'content-type': 'application/json',
      },
      hostname,
      method,
      path: `${target.pathname}${target.search}`,
      port: target.port,
    }, (response) => {
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
    request.end(body);
  });
}

function createLogCaptureLogger(): ApplicationLogger & { messages: string[] } {
  const messages: string[] = [];
  const capture = (...args: unknown[]) => messages.push(args.map((arg) => String(arg)).join(' '));

  return {
    debug: capture,
    error: capture,
    log: capture,
    messages,
    warn: capture,
  };
}

async function runWithCleanup(app: AppLike, adapterName: string, assertion: () => Promise<void>): Promise<void> {
  let hasAssertionError = false;
  let assertionError: unknown;

  try {
    await assertion();
  } catch (error) {
    hasAssertionError = true;
    assertionError = error;
  }

  try {
    await app.close();
  } catch (cleanupError) {
    if (hasAssertionError) {
      throw new AggregateError(
        [assertionError, cleanupError],
        `${adapterName} adapter portability assertion failed and app.close() also failed during harness cleanup.`,
      );
    }

    throw new AggregateError(
      [cleanupError],
      `${adapterName} adapter app.close() failed during portability harness cleanup.`,
    );
  }

  if (hasAssertionError) {
    throw assertionError;
  }
}

async function runWithListeningUrlCleanup(
  app: AppLike,
  adapterName: string,
  assertion: (baseUrl: string) => Promise<void>,
): Promise<void> {
  await runWithCleanup(app, adapterName, async () => {
    await assertion(resolveListeningUrl(app, adapterName));
  });
}

async function prepareAndListenWithCleanup(
  app: AppLike,
  adapterName: string,
  prepare?: () => Promise<void>,
): Promise<void> {
  try {
    await prepare?.();
    await app.listen();
  } catch (setupError) {
    try {
      await app.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        `${adapterName} adapter portability setup failed and app.close() also failed during harness cleanup.`,
      );
    }

    throw setupError;
  }
}

async function runApplicationWithRejectedAppCleanup<TApp extends AppLike>(
  run: () => Promise<TApp>,
  adapterName: string,
): Promise<TApp> {
  try {
    return await run();
  } catch (runError) {
    if (!hasRejectedApp(runError)) {
      throw runError;
    }

    try {
      await runError.app.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [runError, cleanupError],
        `${adapterName} adapter run() rejected and app.close() also failed during portability harness cleanup.`,
      );
    }

    throw runError;
  }
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

  /** Verifies JSON, HTML, HEAD, 406, and committed error-response portability. */
  async assertSupportsHttpErrorRepresentations(): Promise<void> {
    const createBootstrapOptions = this.options.createErrorRepresentationBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createErrorRepresentationBootstrapOptions.`);
    }

    await assertNetworkHttpErrorRepresentationPortability({
      bootstrap: this.options.bootstrap,
      createBootstrapOptions,
      name: this.options.name,
    });
  }

  /** Verifies client-disconnect abort propagation without an HTML or JSON fallback commit. */
  async assertDoesNotCommitAbortedHttpErrorRepresentations(): Promise<void> {
    const createBootstrapOptions = this.options.createErrorRepresentationBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createErrorRepresentationBootstrapOptions.`);
    }

    await assertNetworkHttpErrorRepresentationAbortPortability({
      bootstrap: this.options.bootstrap,
      createBootstrapOptions,
      name: this.options.name,
    });
  }

  /** Verifies ordered, non-folded portable response cookies over a real listener. */
  async assertSupportsPortableResponseCookies(): Promise<void> {
    const app = await this.options.bootstrap(createResponseCookiePortabilityModule(), {
      cors: false,
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (url) => {
      assertPortableResponseCookies(
        await fetch(`${url}/response-cookies`),
        this.options.name,
      );
    });
  }

  /** Verifies 304/412 metadata and body suppression through a real network listener. */
  async assertSupportsConditionalRequests(): Promise<void> {
    const createBootstrapOptions = this.options.createConditionalRequestBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createConditionalRequestBootstrapOptions.`);
    }

    @Controller('/validators')
    class ValidatorsController {
      @Produces('application/json')
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }

      @Produces('application/json')
      @Head('/resource')
      headResource() {
        return { id: 'resource' };
      }

      @Post('/resource')
      updateResource() {
        return { id: 'resource' };
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [ValidatorsController] });

    const app = await this.options.bootstrap(AppModule, createBootstrapOptions({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'resource-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      contentNegotiation: {
        formatters: [{
          format(body) {
            return JSON.stringify(body);
          },
          mediaType: 'application/json',
        }],
      },
      cors: false,
      port: 0,
    }));

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const [notModified, preconditionFailed, head] = await Promise.all([
        fetch(`${baseUrl}/validators/resource`, {
          headers: { 'if-none-match': '"resource-v1"' },
        }),
        fetch(`${baseUrl}/validators/resource`, {
          headers: { 'if-match': '"different-resource"' },
          method: 'POST',
        }),
        fetch(`${baseUrl}/validators/resource`, {
          headers: { 'if-none-match': '"resource-v1"' },
          method: 'HEAD',
        }),
      ]);

      if (
        notModified.status !== 304
        || preconditionFailed.status !== 412
        || head.status !== 304
        || await notModified.text() !== ''
        || await preconditionFailed.text() !== ''
        || await head.text() !== ''
        || notModified.headers.get('etag') !== '"resource-v1"'
        || notModified.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || notModified.headers.get('vary') !== 'Accept'
        || preconditionFailed.headers.get('etag') !== '"resource-v1"'
        || preconditionFailed.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || head.headers.get('etag') !== '"resource-v1"'
        || head.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || head.headers.get('vary') !== 'Accept'
      ) {
        throw new Error(`${this.options.name} adapter changed conditional request response semantics.`);
      }
    });
  }

  /** Verifies single-byte-range metadata and payload slicing through a real network listener. */
  async assertSupportsSingleByteRanges(): Promise<void> {
    const createBootstrapOptions = this.options.createConditionalRequestBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createConditionalRequestBootstrapOptions.`);
    }

    @Controller('/assets')
    class AssetController {
      @Get('/logo')
      getLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }

      @Head('/logo')
      headLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }

      @Post('/logo')
      postLogo() {
        return Uint8Array.from([0, 1, 2, 3, 4, 5]);
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [AssetController] });

    const app = await this.options.bootstrap(AppModule, createBootstrapOptions({
      conditionalRequest: {
        resolve() {
          return {
            exists: true,
            validators: {
              etag: { opaqueValue: 'asset-v1', strength: 'strong' },
              lastModified: new Date('2026-01-01T00:00:00.750Z'),
            },
          };
        },
      },
      cors: false,
      port: 0,
    }));

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const [bounded, suffix, openEnded, malformed, multiple, unsatisfiable, head, post, matchingEtag, nonmatchingEtag, matchingDate, nonmatchingDate] = await Promise.all([
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=2-4' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=-2' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=3-' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'items=2-4' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=0-1,3-4' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=9-' } }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=2-4' }, method: 'HEAD' }),
        fetch(`${baseUrl}/assets/logo`, { headers: { range: 'bytes=2-4' }, method: 'POST' }),
        fetch(`${baseUrl}/assets/logo`, {
          headers: { 'if-range': '"asset-v1"', range: 'bytes=2-4' },
        }),
        fetch(`${baseUrl}/assets/logo`, {
          headers: { 'if-range': '"different-asset"', range: 'bytes=2-4' },
        }),
        fetch(`${baseUrl}/assets/logo`, {
          headers: { 'if-range': 'Thu, 01 Jan 2026 00:00:00 GMT', range: 'bytes=2-4' },
        }),
        fetch(`${baseUrl}/assets/logo`, {
          headers: { 'if-range': 'Wed, 31 Dec 2025 23:59:59 GMT', range: 'bytes=2-4' },
        }),
      ]);

      const [boundedBytes, suffixBytes, openEndedBytes, malformedBytes, multipleBytes, unsatisfiableBody, headBody, postBytes, matchingEtagBytes, nonmatchingEtagBytes, matchingDateBytes, nonmatchingDateBytes] = await Promise.all([
        bounded.bytes(),
        suffix.bytes(),
        openEnded.bytes(),
        malformed.bytes(),
        multiple.bytes(),
        unsatisfiable.text(),
        head.text(),
        post.bytes(),
        matchingEtag.bytes(),
        nonmatchingEtag.bytes(),
        matchingDate.bytes(),
        nonmatchingDate.bytes(),
      ]);

      if (
        bounded.status !== 206
        || suffix.status !== 206
        || openEnded.status !== 206
        || malformed.status !== 200
        || multiple.status !== 200
        || unsatisfiable.status !== 416
        || head.status !== 206
        || post.status !== 201
        || matchingEtag.status !== 206
        || nonmatchingEtag.status !== 200
        || matchingDate.status !== 206
        || nonmatchingDate.status !== 200
        || bounded.headers.get('accept-ranges') !== 'bytes'
        || bounded.headers.get('content-range') !== 'bytes 2-4/6'
        || bounded.headers.get('content-length') !== '3'
        || suffix.headers.get('content-range') !== 'bytes 4-5/6'
        || openEnded.headers.get('content-range') !== 'bytes 3-5/6'
        || openEnded.headers.get('content-length') !== '3'
        || unsatisfiable.headers.get('accept-ranges') !== 'bytes'
        || unsatisfiable.headers.get('content-range') !== 'bytes */6'
        || unsatisfiable.headers.get('content-length') !== '0'
        || unsatisfiableBody !== ''
        || head.headers.get('content-range') !== bounded.headers.get('content-range')
        || head.headers.get('content-length') !== bounded.headers.get('content-length')
        || headBody !== ''
        || matchingEtag.headers.get('content-range') !== 'bytes 2-4/6'
        || matchingEtag.headers.get('etag') !== '"asset-v1"'
        || matchingDate.headers.get('content-range') !== 'bytes 2-4/6'
        || matchingDate.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || !equalByteArrays(boundedBytes, Uint8Array.from([2, 3, 4]))
        || !equalByteArrays(suffixBytes, Uint8Array.from([4, 5]))
        || !equalByteArrays(openEndedBytes, Uint8Array.from([3, 4, 5]))
        || !equalByteArrays(malformedBytes, Uint8Array.from([0, 1, 2, 3, 4, 5]))
        || !equalByteArrays(multipleBytes, Uint8Array.from([0, 1, 2, 3, 4, 5]))
        || !equalByteArrays(postBytes, Uint8Array.from([0, 1, 2, 3, 4, 5]))
        || !equalByteArrays(matchingEtagBytes, Uint8Array.from([2, 3, 4]))
        || !equalByteArrays(nonmatchingEtagBytes, Uint8Array.from([0, 1, 2, 3, 4, 5]))
        || !equalByteArrays(matchingDateBytes, Uint8Array.from([2, 3, 4]))
        || !equalByteArrays(nonmatchingDateBytes, Uint8Array.from([0, 1, 2, 3, 4, 5]))
      ) {
        throw new Error(`${this.options.name} adapter changed single byte-range or If-Range response semantics.`);
      }
    });
  }

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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/cookies`, {
        headers: {
          cookie: 'good=hello%20world; bad=%E0%A4%A',
        },
      });

      if (response.status !== 200) {
        throw new Error(
          `${this.options.name} adapter changed malformed-cookie handling: expected 200 but received ${String(response.status)}.`,
        );
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
    });
  }

  /** Verifies `QUERY` and extension-method execution through the adapter's real listener fallback. */
  async assertSupportsCustomHttpRouteMethods(): Promise<void> {
    @Controller('/custom-methods')
    class CustomMethodController {
      @Query('/query')
      query(_input: undefined, context: RequestContext) {
        return { body: context.request.body, method: context.request.method };
      }

      @Route('PURGE', '/purge')
      purge(_input: undefined, context: RequestContext) {
        return { body: context.request.body, method: context.request.method };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [CustomMethodController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      for (const method of ['QUERY', 'PURGE']) {
        const body = JSON.stringify({ value: method.toLowerCase() });
        const response = await requestCustomHttpMethod(
          `${baseUrl}/custom-methods/${method.toLowerCase()}`,
          method,
          body,
        );

        if (response.statusCode !== 200) {
          throw new Error(
            `${this.options.name} adapter changed ${method} response status semantics: received ${String(response.statusCode)}.`,
          );
        }

        if (JSON.stringify(JSON.parse(response.body)) !== JSON.stringify({
          body: { value: method.toLowerCase() },
          method,
        })) {
          throw new Error(`${this.options.name} adapter changed ${method} method or body semantics.`);
        }
      }
    });
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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
      rawBody: true,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const [jsonResponse, textResponse] = await Promise.all([
        fetch(`${baseUrl}/webhooks/json`, {
          body: JSON.stringify({ provider: 'stripe' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
        fetch(`${baseUrl}/webhooks/text`, {
          body: 'ping=1',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          method: 'POST',
        }),
      ]);

      if (jsonResponse.status !== 201 || textResponse.status !== 201) {
        throw new Error(`${this.options.name} adapter changed rawBody response status semantics.`);
      }

      const [jsonBody, textBody] = await Promise.all([jsonResponse.json(), textResponse.json()]);

      if (
        JSON.stringify(jsonBody) !==
        JSON.stringify({
          parsed: { provider: 'stripe' },
          raw: '{"provider":"stripe"}',
        })
      ) {
        throw new Error(`${this.options.name} adapter changed JSON rawBody semantics.`);
      }

      if (JSON.stringify(textBody) !== JSON.stringify({ parsed: 'ping=1', raw: 'ping=1' })) {
        throw new Error(`${this.options.name} adapter changed text rawBody semantics.`);
      }
    });
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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
      rawBody: true,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name, async () => {
      await this.options.prepareExactRawBodyByteTest?.(app);
    });

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const payload = Uint8Array.from([0xe9, 0x41]);
      const contentType = this.options.exactRawBodyByteContentType ?? 'text/plain; charset=latin1';
      const response = await fetch(`${baseUrl}/webhooks/bytes`, {
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
    });
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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
      rawBody: true,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const response = await fetch(`${baseUrl}/uploads`, {
        body: form,
        method: 'POST',
      });

      if (response.status !== 201) {
        throw new Error(`${this.options.name} adapter changed multipart response status semantics.`);
      }

      const body = await response.json();
      if (
        JSON.stringify(body) !==
        JSON.stringify({
          body: { name: 'Ada' },
          fileCount: 1,
          hasRawBody: false,
        })
      ) {
        throw new Error(`${this.options.name} adapter changed multipart rawBody semantics.`);
      }
    });
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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      maxBodySize: 8,
      multipart: {
        maxFileSize: 1024,
      },
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['12345678'], { type: 'text/plain' }), 'payload.txt');

      const response = await fetch(`${baseUrl}/uploads`, {
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
    });
  }

  async assertSupportsSseStreaming(): Promise<void> {
    let resolveHandlerReady!: (stream: SseResponse) => void;
    const handlerReady = new Promise<SseResponse>((resolve) => {
      resolveHandlerReady = resolve;
    });

    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);

        stream.comment('connected');
        stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
        resolveHandlerReady(stream);

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const client = new AbortController();

      try {
        const responsePromise = fetch(`${baseUrl}/events`, {
          headers: { accept: 'text/event-stream' },
          signal: client.signal,
        });
        const stream = await withTimeout(
          handlerReady,
          2_000,
          `${this.options.name} adapter did not enter the SSE handler.`,
        );
        stream.close();
        const response = await responsePromise;
        const body = await withTimeout(
          response.text(),
          2_000,
          `${this.options.name} adapter did not close the SSE response stream.`,
        );

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
        client.abort();
      }
    });
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

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      port: 0,
    } as TBootstrapOptions);

    await prepareAndListenWithCleanup(app, this.options.name);

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events`, {
        headers: { accept: 'text/event-stream' },
      });

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed closed stream response status semantics.`);
      }

      await response.text();
      await withTimeout(
        drainWaitSettled,
        2_000,
        `${this.options.name} adapter left response.stream.waitForDrain() pending after close.`,
      );
    });
  }

  async assertReportsConfiguredHostInStartupLogs(): Promise<void> {
    const logger = createLogCaptureLogger();

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

    const app = await runApplicationWithRejectedAppCleanup(
      () =>
        this.options.run(AppModule, {
          cors: false,
          host: '127.0.0.1',
          logger,
          port: 0,
        } as TRunOptions),
      this.options.name,
    );

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed host-bound health response semantics.`);
      }

      const body = await response.json();
      if (JSON.stringify(body) !== JSON.stringify({ ok: true })) {
        throw new Error(`${this.options.name} adapter changed host-bound response payload.`);
      }

      if (!logger.messages.some((message) => message.includes(`Listening on ${baseUrl}`))) {
        throw new Error(`${this.options.name} adapter changed startup host logging.`);
      }
    });
  }

  async assertReportsHttpsStartupUrl(https: { cert: string; key: string }): Promise<void> {
    const logger = createLogCaptureLogger();

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

    const app = await runApplicationWithRejectedAppCleanup(
      () =>
        this.options.run(AppModule, {
          cors: false,
          host: '127.0.0.1',
          https,
          logger,
          port: 0,
        } as TRunOptions),
      this.options.name,
    );

    await runWithListeningUrlCleanup(app, this.options.name, async (baseUrl) => {
      const response = await requestHttps(`${baseUrl}/health`);

      if (response.statusCode !== 200) {
        throw new Error(`${this.options.name} adapter changed HTTPS response status semantics.`);
      }

      if (JSON.stringify(JSON.parse(response.body)) !== JSON.stringify({ ok: true })) {
        throw new Error(`${this.options.name} adapter changed HTTPS response payload semantics.`);
      }

      if (!logger.messages.some((message) => message.includes(`Listening on ${baseUrl}`))) {
        throw new Error(`${this.options.name} adapter changed HTTPS startup logging.`);
      }
    });
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
    const listenersBefore = new Set(process.listeners(signal));
    const app = await runApplicationWithRejectedAppCleanup(
      () =>
        this.options.run(AppModule, {
          cors: false,
          logger,
          port: 0,
          shutdownSignals: [signal],
        } as TRunOptions),
      this.options.name,
    );
    const registeredListeners = process.listeners(signal).filter((listener) => !listenersBefore.has(listener));

    await runWithCleanup(app, this.options.name, async () => {
      if (registeredListeners.length === 0) {
        throw new Error(`${this.options.name} adapter did not register the expected shutdown listener.`);
      }
    });

    const remainingListeners = process.listeners(signal);
    const leakedListeners = registeredListeners.filter((listener) => remainingListeners.includes(listener));
    if (leakedListeners.length > 0) {
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

function equalByteArrays(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((value, index) => value === right[index]);
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
