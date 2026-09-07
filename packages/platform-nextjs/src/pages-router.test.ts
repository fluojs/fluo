import { Buffer } from 'node:buffer';
import {
  Readable,
  Writable,
} from 'node:stream';

import { Module } from '@fluojs/core';
import {
  Controller,
  Convert,
  FromCookie,
  Get,
  HttpCode,
  type MiddlewareContext,
  type Next,
  Post,
  type RequestContext,
  RequestDto,
} from '@fluojs/http';
import {
  type Application,
  FluoFactory,
} from '@fluojs/runtime';
import type { NextApiHandler } from 'next';
import { afterEach, describe, expect, it } from 'vitest';

import { createNextAdapter } from './adapter.js';
import { dispatchNextPagesRequest } from './pages-bridge.js';
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from './pages-router.js';

class TestPagesRequest extends Readable {
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly method;
  readonly url;
  private bodySent = false;

  constructor(
    method: string,
    url: string,
    private readonly body?: string,
    headers: Readonly<
      Record<string, string | readonly string[] | undefined>
    > = {},
  ) {
    super();
    this.headers = body === undefined
      ? headers
      : { 'content-type': 'application/json', ...headers };
    this.method = method;
    this.url = url;
  }

  override _read(): void {
    if (this.bodySent) {
      return;
    }

    this.bodySent = true;
    if (this.body !== undefined) {
      this.push(Buffer.from(this.body));
    }
    this.push(null);
  }
}

class TestPagesResponse extends Writable {
  readonly chunks: Buffer[] = [];
  readonly headers = new Map<string, number | string | readonly string[]>();
  statusCode = 200;
  statusMessage = '';

  setHeader(
    name: string,
    value: number | string | readonly string[],
  ): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk);
    callback();
  }
}

function isEchoBody(value: unknown): value is { readonly message: string } {
  return typeof value === 'object'
    && value !== null
    && 'message' in value
    && typeof value.message === 'string';
}

class PagesSessionConverter {
  convert(value: unknown) {
    return typeof value === 'string' ? `converted:${value}` : value;
  }
}

class PagesSessionRequest {
  @FromCookie('session')
  @Convert(PagesSessionConverter)
  session = '';
}

class PagesPipelineMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    context.response.setHeader('x-pages-middleware', 'ran');
    await next();
  }
}

@Controller('/api')
class PagesApiController {
  @Post('/echo')
  @HttpCode(201)
  echo(_input: undefined, context: RequestContext) {
    const body = context.request.body;

    if (!isEchoBody(body)) {
      context.response.setStatus(400);
      return { code: 'invalid_echo_body' };
    }

    return { message: body.message };
  }

  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Get('/pipeline')
  @RequestDto(PagesSessionRequest)
  pipeline(input: PagesSessionRequest, context: RequestContext) {
    context.response.setHeader('set-cookie', [
      'session=rotated; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/',
    ]);
    return { session: input.session };
  }
}

@Module({
  controllers: [PagesApiController],
  middleware: [PagesPipelineMiddleware],
  providers: [PagesSessionConverter],
})
class PagesAppModule {}

const activeApplications: Application[] = [];

async function createTestAdapter() {
  const adapter = createNextAdapter();
  const app = await FluoFactory.create(PagesAppModule, { adapter });
  await app.listen();
  activeApplications.push(app);
  return adapter;
}

afterEach(async () => {
  for (const app of activeApplications.splice(0)) {
    await app.close('pages test cleanup');
  }
});

describe('Next.js Pages Router bridge', () => {
  it('exports a Next API handler and disables the built-in body parser', async () => {
    const adapter = await createTestAdapter();
    const handler: NextApiHandler<unknown> =
      createNextPagesRouterHandler(async () => adapter);
    const config = {
      api: {
        bodyParser: false,
      },
    } satisfies NextPagesRouterConfig;

    expect(handler).toBeTypeOf('function');
    expect(config).toEqual({
      api: {
        bodyParser: false,
      },
    });
  });

  it('streams a Pages request and response through Fluo', async () => {
    const request = new TestPagesRequest(
      'POST',
      '/api/echo',
      JSON.stringify({ message: 'hello' }),
    );
    const response = new TestPagesResponse();

    await dispatchNextPagesRequest(
      await createTestAdapter(),
      request,
      response,
    );

    expect(response.statusCode).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(response.text())).toEqual({ message: 'hello' });
  });

  it('preserves malformed-body and not-found responses', async () => {
    const adapter = await createTestAdapter();
    const malformedResponse = new TestPagesResponse();
    const missingResponse = new TestPagesResponse();

    await dispatchNextPagesRequest(
      adapter,
      new TestPagesRequest('POST', '/api/echo', '{'),
      malformedResponse,
    );
    await dispatchNextPagesRequest(
      adapter,
      new TestPagesRequest('GET', '/api/missing'),
      missingResponse,
    );

    expect(malformedResponse.statusCode).toBe(400);
    expect(missingResponse.statusCode).toBe(404);
  });

  it('preserves cookie binding, middleware, converters, and Set-Cookie arrays', async () => {
    const response = new TestPagesResponse();

    await dispatchNextPagesRequest(
      await createTestAdapter(),
      new TestPagesRequest(
        'GET',
        '/api/pipeline',
        undefined,
        { cookie: 'session=hello%20pages; theme=light' },
      ),
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('x-pages-middleware')).toBe('ran');
    expect(response.headers.get('set-cookie')).toEqual([
      'session=rotated; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/',
    ]);
    expect(JSON.parse(response.text())).toEqual({
      session: 'converted:hello pages',
    });
  });
});
