import { Controller, Get, Post, Query, type RequestContext, Route, SseResponse } from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { assertWebHttpErrorRepresentationAbortPortability } from './error-representation-abort-portability.js';
import {
  assertWebHttpErrorRepresentationPortability,
  type WebHttpErrorRepresentationBootstrapOptions,
} from './error-representation-portability.js';

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

  async assertStreamsPortableMultipartParts(): Promise<void> {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      async upload(_input: undefined, context: RequestContext) {
        const multipart = context.request.multipart;

        if (!multipart) {
          throw new Error('Expected streaming multipart mode.');
        }

        const reader = multipart.consume().getReader();
        const parts: Array<Record<string, unknown>> = [];

        for (;;) {
          const result = await reader.read();

          if (result.done) {
            break;
          }

          if (result.value.kind === 'field') {
            parts.push({
              fieldname: result.value.fieldname,
              kind: result.value.kind,
              value: result.value.value,
            });
            continue;
          }

          parts.push({
            fieldname: result.value.fieldname,
            kind: result.value.kind,
            mimetype: result.value.mimetype,
            originalname: result.value.originalname,
            value: await new Response(result.value.stream).text(),
          });
        }

        return {
          bodyAbsent: context.request.body === undefined,
          filesAbsent: context.request.files === undefined,
          parts,
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [UploadController],
    });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      multipart: {
        mode: 'streaming',
      },
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['streamed-file'], { type: 'text/plain' }), 'payload.txt');

      const response = await app.dispatch(new Request('https://runtime.test/uploads', {
        body: form,
        method: 'POST',
      }));
      const body = await response.json();
      const expected = {
        bodyAbsent: true,
        filesAbsent: true,
        parts: [
          {
            fieldname: 'name',
            kind: 'field',
            value: 'Ada',
          },
          {
            fieldname: 'payload',
            kind: 'file',
            mimetype: 'text/plain',
            originalname: 'payload.txt',
            value: 'streamed-file',
          },
        ],
      };

      if (response.status !== 201 || JSON.stringify(body) !== JSON.stringify(expected)) {
        throw new Error(
          `${this.options.name} adapter changed portable streaming multipart semantics: ${JSON.stringify(body)}`,
        );
      }
    });
  }

  async assertStreamingMultipartConformance(): Promise<void> {
    await this.assertStreamsPortableMultipartParts();
    await this.assertEnforcesStreamingMultipartLimits();
    await this.assertRejectsSecondStreamingMultipartConsumption();
    await this.assertAbortsAndCleansStreamingMultipart();
  }

  async assertEnforcesStreamingMultipartLimits(): Promise<void> {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      async upload(_input: undefined, context: RequestContext) {
        const multipart = context.request.multipart;

        if (!multipart) {
          throw new Error('Expected streaming multipart mode.');
        }

        const reader = multipart.consume().getReader();

        for (;;) {
          const result = await reader.read();

          if (result.done) {
            return { consumed: true };
          }

          if (result.value.kind === 'file') {
            await new Response(result.value.stream).arrayBuffer();
          }
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UploadController] });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      multipart: {
        maxFields: 1,
        maxFileSize: 4,
        maxFiles: 1,
        maxHeaders: 2,
        maxHeaderSize: 128,
        maxTotalSize: 2048,
        mode: 'streaming',
      },
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      for (const current of createStreamingMultipartLimitCases()) {
        const response = await app.dispatch(new Request('https://runtime.test/uploads', {
          body: current.body,
          headers: {
            'content-type': `multipart/form-data; boundary=${current.boundary}`,
          },
          method: 'POST',
        }));
        const body = await response.json() as { error?: { code?: unknown } };

        if (response.status !== 413 || body.error?.code !== 'PAYLOAD_TOO_LARGE') {
          throw new Error(
            `${this.options.name} adapter did not enforce streaming multipart ${current.name}.`,
          );
        }
      }
    });
  }

  async assertRejectsSecondStreamingMultipartConsumption(): Promise<void> {
    @Controller('/uploads')
    class UploadController {
      @Post('/')
      upload(_input: undefined, context: RequestContext) {
        const multipart = context.request.multipart;

        if (!multipart) {
          throw new Error('Expected streaming multipart mode.');
        }

        const first = multipart.consume();

        try {
          multipart.consume();
          return { rejected: false };
        } catch (error: unknown) {
          void first.cancel('Second-consume conformance completed.');
          return {
            message: error instanceof Error ? error.message : String(error),
            name: error instanceof Error ? error.name : typeof error,
            rejected: true,
          };
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UploadController] });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      multipart: { mode: 'streaming' },
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const form = new FormData();
      form.set('name', 'Ada');
      const response = await app.dispatch(new Request('https://runtime.test/uploads', {
        body: form,
        method: 'POST',
      }));
      const body = await response.json();

      if (
        response.status !== 201
        || JSON.stringify(body) !== JSON.stringify({
          message: 'Streaming multipart body can only be consumed once.',
          name: 'TypeError',
          rejected: true,
        })
      ) {
        throw new Error(`${this.options.name} adapter changed multipart second-consume rejection.`);
      }
    });
  }

  async assertAbortsAndCleansStreamingMultipart(): Promise<void> {
    const handlerReady = createDeferred<void>();
    const abortObserved = createDeferred<{ error: unknown; signalReason: unknown }>();
    const sourceCancelled = createDeferred<unknown>();

    @Controller('/uploads')
    class UploadController {
      @Post('/')
      async upload(_input: undefined, context: RequestContext) {
        const multipart = context.request.multipart;

        if (!multipart || !context.request.signal) {
          throw new Error('Expected streaming multipart mode with an abort signal.');
        }

        const part = await multipart.consume().getReader().read();

        if (part.done || part.value.kind !== 'file') {
          throw new Error('Expected a streaming multipart file part.');
        }

        const fileReader = part.value.stream.getReader();
        const first = await fileReader.read();

        if (first.done || first.value.byteLength === 0) {
          throw new Error('Expected the first streaming multipart file chunk.');
        }

        handlerReady.resolve();

        try {
          await fileReader.read();
          throw new Error('Expected the active multipart file stream to abort.');
        } catch (error: unknown) {
          abortObserved.resolve({
            error,
            signalReason: context.request.signal.reason,
          });
          throw error;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, { controllers: [UploadController] });

    const app = await this.options.bootstrap(AppModule, {
      cors: false,
      multipart: { mode: 'streaming' },
    } as TBootstrapOptions);

    await runWithCleanup(app, this.options.name, async () => {
      const abortController = new AbortController();
      const boundary = 'fluo-abort-boundary';
      const prefix = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="payload"; filename="payload.txt"',
        'Content-Type: text/plain',
        '',
        'x'.repeat(256),
      ].join('\r\n');
      const requestBody = new ReadableStream<Uint8Array>({
        cancel(reason) {
          sourceCancelled.resolve(reason);
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode(prefix));
        },
      });
      const dispatchPromise = app.dispatch(new Request('https://runtime.test/uploads', {
        body: requestBody,
        duplex: 'half',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        method: 'POST',
        signal: abortController.signal,
      } as RequestInit & { duplex: 'half' }));

      await withTimeout(
        handlerReady.promise,
        5_000,
        `${this.options.name} adapter did not enter the multipart handler before abort.`,
      );
      abortController.abort(new Error('multipart client aborted'));

      const [observed] = await Promise.all([
        withTimeout(
          abortObserved.promise,
          5_000,
          `${this.options.name} adapter did not surface multipart abort to the active file stream.`,
        ),
        withTimeout(
          sourceCancelled.promise,
          5_000,
          `${this.options.name} adapter did not cancel the multipart request source.`,
        ),
      ]);

      try {
        await dispatchPromise;
      } catch {
        // An aborted host-owned dispatch may reject instead of returning a response.
      }

      if (!(observed.error instanceof Error) || observed.error !== observed.signalReason) {
        throw new Error(`${this.options.name} adapter did not propagate multipart request abort.`);
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value?: T): void;
}

interface StreamingMultipartLimitCase {
  body: string;
  boundary: string;
  name: string;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = (value) => resolvePromise(value as T);
  });
  return { promise, resolve };
}

function createStreamingMultipartLimitCases(): StreamingMultipartLimitCase[] {
  return [
    createStreamingMultipartLimitCase('file-size', [
      'Content-Disposition: form-data; name="payload"; filename="payload.txt"\r\n'
        + 'Content-Type: text/plain\r\n\r\nhello',
    ]),
    createStreamingMultipartLimitCase('field-count', [
      'Content-Disposition: form-data; name="first"\r\n\r\none',
      'Content-Disposition: form-data; name="second"\r\n\r\ntwo',
    ]),
    createStreamingMultipartLimitCase('file-count', [
      'Content-Disposition: form-data; name="first"; filename="1.txt"\r\n\r\n1',
      'Content-Disposition: form-data; name="second"; filename="2.txt"\r\n\r\n2',
    ]),
    createStreamingMultipartLimitCase('header-count', [
      'Content-Disposition: form-data; name="field"\r\n'
        + 'X-First: one\r\n'
        + 'X-Second: two\r\n\r\nvalue',
    ]),
    createStreamingMultipartLimitCase('header-size', [
      `Content-Disposition: form-data; name="${'field'.repeat(30)}"\r\n\r\nvalue`,
    ]),
    createStreamingMultipartLimitCase('total-size', [
      `Content-Disposition: form-data; name="field"\r\n\r\n${'x'.repeat(4096)}`,
    ]),
  ];
}

function createStreamingMultipartLimitCase(
  name: string,
  parts: readonly string[],
): StreamingMultipartLimitCase {
  const boundary = `fluo-${name}-boundary`;
  return {
    body: parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('')
      + `--${boundary}--\r\n`,
    boundary,
    name,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return await Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}
