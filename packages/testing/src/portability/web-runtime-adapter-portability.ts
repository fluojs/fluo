// @ts-ignore Worktree-local LSP does not resolve workspace package aliases.
import { Controller, Get, Post, SseResponse, type RequestContext } from '@fluojs/http';
// @ts-ignore Worktree-local LSP does not resolve workspace package aliases.
import { defineModule, type ModuleType, type UploadedFile } from '@fluojs/runtime';

declare module '@fluojs/http' {
  interface FrameworkRequest {
    files?: UploadedFile[];
    rawBody?: Uint8Array;
  }
}

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
  name: string;
}

function decodeUtf8(input: Uint8Array | undefined): string {
  return new TextDecoder().decode(input ?? new Uint8Array());
}

async function closeSilently(app: WebRuntimePortabilityAppLike): Promise<void> {
  try {
    await app.close();
  } catch {}
}

/**
 * Represents the web runtime http adapter portability harness.
 */
export class WebRuntimeHttpAdapterPortabilityHarness<
  TBootstrapOptions extends object,
  TApp extends WebRuntimePortabilityAppLike = WebRuntimePortabilityAppLike,
> {
  constructor(private readonly options: WebRuntimeHttpAdapterPortabilityHarnessOptions<TBootstrapOptions, TApp>) {}

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

    const app = await this.options.bootstrap(AppModule, { cors: false } as TBootstrapOptions);

    try {
      const response = await app.dispatch(new Request('https://runtime.test/cookies', {
        headers: {
          cookie: 'good=hello%20world; bad=%E0%A4%A',
        },
      }));

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

    const app = await this.options.bootstrap(AppModule, { cors: false, rawBody: true } as TBootstrapOptions);

    try {
      const [jsonResponse, textResponse] = await Promise.all([
        app.dispatch(new Request('https://runtime.test/webhooks/json', {
          body: JSON.stringify({ provider: 'stripe' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })),
        app.dispatch(new Request('https://runtime.test/webhooks/text', {
          body: 'ping=1',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          method: 'POST',
        })),
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

    const app = await this.options.bootstrap(AppModule, { cors: false, rawBody: true } as TBootstrapOptions);

    try {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const response = await app.dispatch(new Request('https://runtime.test/uploads', {
        body: form,
        method: 'POST',
      }));

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

    const app = await this.options.bootstrap(AppModule, { cors: false } as TBootstrapOptions);

    try {
      const response = await app.dispatch(new Request('https://runtime.test/events', {
        headers: { accept: 'text/event-stream' },
      }));
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
