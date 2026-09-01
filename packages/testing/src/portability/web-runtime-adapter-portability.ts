import {
  Controller,
  Get,
  Head,
  Post,
  Query,
  type ConditionalRequestOptions,
  type RequestContext,
  Route,
  SseResponse,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { assertWebHttpErrorRepresentationAbortPortability } from './error-representation-abort-portability.js';
import {
  assertWebHttpErrorRepresentationPortability,
  type WebHttpErrorRepresentationBootstrapOptions,
} from './error-representation-portability.js';
import {
  assertPortableResponseCookies,
  createResponseCookiePortabilityModule,
} from './response-cookie-portability.js';

export type { WebHttpErrorRepresentationBootstrapOptions } from './error-representation-portability.js';

type WebRuntimePortabilityAppLike = {
  close(): Promise<void>;
  dispatch(request: Request): Promise<Response>;
};

/**
 * Describes the web runtime http adapter portability harness options contract.
 */
export interface WebRuntimeHttpAdapterPortabilityHarnessOptions<
  TBootstrapOptions extends object,
  TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
> {
  bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  /** Adapts the shared error-representation fixture fields to this runtime's bootstrap options. */
  createErrorRepresentationBootstrapOptions?: (
    options: WebHttpErrorRepresentationBootstrapOptions,
  ) => TBootstrapOptions;
  /** Adapts shared conditional-request policy options to one web runtime bootstrap API. */
  createConditionalRequestBootstrapOptions?: (
    options: { readonly conditionalRequest: ConditionalRequestOptions; readonly cors: false },
  ) => TBootstrapOptions;
  name: string;
}

function decodeUtf8(input: Uint8Array | undefined): string {
  return new TextDecoder().decode(input ?? new Uint8Array());
}

async function runWithCleanup(
  app: WebRuntimePortabilityAppLike,
  adapterName: string,
  assertion: () => Promise<void>,
): Promise<void> {
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

/**
 * Represents the web runtime http adapter portability harness.
 */
export class WebRuntimeHttpAdapterPortabilityHarness<
  TBootstrapOptions extends object,
  TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
> {
  constructor(private readonly options: WebRuntimeHttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TApp>) {}

  /** Verifies JSON, HTML, HEAD, 406, and committed error-response portability. */
  async assertSupportsHttpErrorRepresentations(): Promise<void> {
    const createBootstrapOptions = this.options.createErrorRepresentationBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createErrorRepresentationBootstrapOptions.`);
    }

    await assertWebHttpErrorRepresentationPortability({
      bootstrap: this.options.bootstrap,
      createBootstrapOptions,
      name: this.options.name,
    });
  }

  /** Verifies request abort propagation without an HTML or JSON fallback commit. */
  async assertDoesNotCommitAbortedHttpErrorRepresentations(): Promise<void> {
    const createBootstrapOptions = this.options.createErrorRepresentationBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createErrorRepresentationBootstrapOptions.`);
    }

    await assertWebHttpErrorRepresentationAbortPortability({
      bootstrap: this.options.bootstrap,
      createBootstrapOptions,
      name: this.options.name,
    });
  }

  /** Verifies ordered, non-folded portable response cookies through Web Response headers. */
  async assertSupportsPortableResponseCookies(): Promise<void> {
    const app = await this.options.bootstrap(createResponseCookiePortabilityModule(), {
      cors: false,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      assertPortableResponseCookies(
        await app.dispatch(new Request('https://runtime.test/response-cookies')),
        this.options.name,
      );
    });
  }

  /** Verifies 304/412 metadata and body suppression through fetch-style adapters. */
  async assertSupportsConditionalRequests(): Promise<void> {
    const createBootstrapOptions = this.options.createConditionalRequestBootstrapOptions;
    if (createBootstrapOptions === undefined) {
      throw new Error(`${this.options.name} adapter portability harness requires createConditionalRequestBootstrapOptions.`);
    }

    @Controller('/validators')
    class ValidatorsController {
      @Get('/resource')
      getResource() {
        return { id: 'resource' };
      }

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
      cors: false,
    }));

    await runWithCleanup(app, this.options.name, async () => {
      const [notModified, preconditionFailed, head] = await Promise.all([
        app.dispatch(new Request('https://runtime.test/validators/resource', {
          headers: { 'if-none-match': '"resource-v1"' },
        })),
        app.dispatch(new Request('https://runtime.test/validators/resource', {
          headers: { 'if-match': '"different-resource"' },
          method: 'POST',
        })),
        app.dispatch(new Request('https://runtime.test/validators/resource', {
          headers: { 'if-none-match': '"resource-v1"' },
          method: 'HEAD',
        })),
      ]);

      if (
        notModified.status !== 304
        || preconditionFailed.status !== 412
        || await notModified.text() !== ''
        || await preconditionFailed.text() !== ''
        || await head.text() !== ''
        || notModified.headers.get('etag') !== '"resource-v1"'
        || notModified.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || preconditionFailed.headers.get('etag') !== '"resource-v1"'
        || preconditionFailed.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
        || head.status !== 304
        || head.headers.get('etag') !== '"resource-v1"'
        || head.headers.get('last-modified') !== 'Thu, 01 Jan 2026 00:00:00 GMT'
      ) {
        throw new Error(`${this.options.name} adapter changed conditional request response semantics.`);
      }
    });
  }

  async assertPreservesQueryArraysAndDecoding(): Promise<void> {
    @Controller('/query')
    class QueryController {
      @Get('/')
      readQuery(_input: undefined, context: RequestContext) {
        return context.request.query;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [QueryController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const response = await app.dispatch(
        new Request('https://runtime.test/query?tag=one&tag=two&encoded=hello+world&flag&bad=%E0%A4%A'),
      );

      if (response.status !== 200) {
        throw new Error(`${this.options.name} adapter changed query response status semantics.`);
      }

      const body = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        (body as Record<string, unknown>).bad !== '�%A' ||
        (body as Record<string, unknown>).encoded !== 'hello world' ||
        !Array.isArray((body as Record<string, unknown>).tag) ||
        JSON.stringify((body as Record<string, unknown>).tag) !== JSON.stringify(['one', 'two'])
      ) {
        throw new Error(`${this.options.name} adapter changed query decoding semantics.`);
      }
    });
  }

  /** Verifies `QUERY` and extension-method execution through the runtime's fetch dispatch seam. */
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
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      for (const method of ['QUERY', 'PURGE']) {
        const response = await app.dispatch(new Request(
          `https://runtime.test/custom-methods/${method.toLowerCase()}`,
          {
            body: JSON.stringify({ value: method.toLowerCase() }),
            headers: { 'content-type': 'application/json' },
            method,
          },
        ));

        if (response.status !== 200) {
          throw new Error(
            `${this.options.name} adapter changed ${method} response status semantics: received ${String(response.status)}.`,
          );
        }

        const body = await response.json();
        if (JSON.stringify(body) !== JSON.stringify({
          body: { value: method.toLowerCase() },
          method,
        })) {
          throw new Error(`${this.options.name} adapter changed ${method} method or body semantics.`);
        }
      }
    });
  }

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
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const response = await app.dispatch(
        new Request('https://runtime.test/cookies', {
          headers: {
            cookie: 'good=hello%20world; bad=%E0%A4%A',
          },
        }),
      );

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

  async assertPreservesRawBodyForJsonAndText(): Promise<void> {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/json')
      handleJson(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: decodeUtf8(context.request.rawBody),
        };
      }

      @Post('/text')
      handleText(_input: undefined, context: RequestContext) {
        return {
          parsed: context.request.body,
          raw: decodeUtf8(context.request.rawBody),
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      rawBody: true,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const [jsonResponse, textResponse] = await Promise.all([
        app.dispatch(
          new Request('https://runtime.test/webhooks/json', {
            body: JSON.stringify({ provider: 'stripe' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }),
        ),
        app.dispatch(
          new Request('https://runtime.test/webhooks/text', {
            body: 'ping=1',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            method: 'POST',
          }),
        ),
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

  /**
   * Asserts that byte-sensitive request bodies preserve their exact raw bytes.
   */
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
      rawBody: true,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const payload = Uint8Array.from([0xe9, 0x41]);
      const response = await app.dispatch(
        new Request('https://runtime.test/webhooks/bytes', {
          body: payload,
          headers: { 'content-type': 'application/octet-stream' },
          method: 'POST',
        }),
      );

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
      rawBody: true,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const response = await app.dispatch(
        new Request('https://runtime.test/uploads', {
          body: form,
          method: 'POST',
        }),
      );

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

  async assertSupportsSseStreaming(): Promise<void> {
    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, context: RequestContext) {
        const stream = new SseResponse(context);

        stream.comment('connected');
        stream.send({ ready: true }, { event: 'ready', id: 'evt-1' });
        stream.close();

        return stream;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [EventsController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const response = await app.dispatch(
        new Request('https://runtime.test/events', {
          headers: { accept: 'text/event-stream' },
        }),
      );
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
    });
  }
}

/**
 * Create web runtime http adapter portability harness.
 *
 * @param options The options.
 * @returns The create web runtime http adapter portability harness result.
 */
export function createWebRuntimeHttpAdapterPortabilityHarness<
  TBootstrapOptions extends object,
  TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
>(
  options: WebRuntimeHttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TApp>,
): WebRuntimeHttpAdapterPortabilityHarness<TBootstrapOptions, TApp> {
  return new WebRuntimeHttpAdapterPortabilityHarness(options);
}
