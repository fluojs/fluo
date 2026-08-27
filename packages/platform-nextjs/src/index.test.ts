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
import { afterEach, describe, expect, it } from 'vitest';

import {
  createNextAdapter,
  createNextAppRouterHandler,
  type NextHttpApplicationAdapter,
} from './index.js';

interface TestBackend {
  readonly adapter: NextHttpApplicationAdapter;
  readonly app: Application;
}

const activeApplications: Application[] = [];

function isEchoBody(value: unknown): value is { readonly message: string } {
  return typeof value === 'object'
    && value !== null
    && 'message' in value
    && typeof value.message === 'string';
}

class SessionConverter {
  convert(value: unknown) {
    return typeof value === 'string' ? `converted:${value}` : value;
  }
}

class SessionRequest {
  @FromCookie('session')
  @Convert(SessionConverter)
  session = '';
}

class PipelineMiddleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    context.response.setHeader('x-fluo-middleware', 'ran');
    await next();
  }
}

@Controller('/api')
class ApiController {
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
  @RequestDto(SessionRequest)
  pipeline(input: SessionRequest, context: RequestContext) {
    context.response.setHeader('set-cookie', [
      'session=rotated; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/',
    ]);
    return { session: input.session };
  }
}

@Module({
  controllers: [ApiController],
  middleware: [PipelineMiddleware],
  providers: [SessionConverter],
})
class AppModule {}

async function createTestBackend(): Promise<TestBackend> {
  const adapter = createNextAdapter();
  const app = await FluoFactory.create(AppModule, { adapter });
  await app.listen();
  activeApplications.push(app);

  return { adapter, app };
}

afterEach(async () => {
  for (const app of activeApplications.splice(0)) {
    await app.close('test cleanup');
  }
});

describe('@fluojs/platform-nextjs', () => {
  it('exports one Next handler across every supported HTTP method', async () => {
    const adapter = createNextAdapter();
    const exportedHandlers = [
      adapter.GET,
      adapter.POST,
      adapter.PUT,
      adapter.PATCH,
      adapter.DELETE,
      adapter.HEAD,
      adapter.OPTIONS,
    ];

    expect(new Set(exportedHandlers)).toHaveLength(1);
    await adapter.close();
  });

  it('dispatches a decorated module through FluoFactory', async () => {
    const { adapter } = await createTestBackend();

    const response = await adapter.GET(
      new Request('https://next.test/api/health'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('materializes JSON bodies and preserves malformed-body and not-found errors', async () => {
    const { adapter } = await createTestBackend();

    const created = await adapter.POST(new Request('https://next.test/api/echo', {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));
    const malformed = await adapter.POST(new Request('https://next.test/api/echo', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));
    const missing = await adapter.GET(new Request('https://next.test/api/missing'));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ message: 'hello' });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: {
        status: 400,
      },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: {
        status: 404,
      },
    });
  });

  it('preserves cookies, middleware, converters, and multiple Set-Cookie headers', async () => {
    const { adapter } = await createTestBackend();

    const response = await adapter.GET(
      new Request('https://next.test/api/pipeline', {
        headers: {
          cookie: 'session=hello%20next; theme=light',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-fluo-middleware')).toBe('ran');
    expect(response.headers.getSetCookie()).toEqual([
      'session=rotated; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark; Path=/',
    ]);
    await expect(response.json()).resolves.toEqual({
      session: 'converted:hello next',
    });
  });

  it('lets FluoFactory own idempotent application startup', async () => {
    const adapter = createNextAdapter();
    const app = await FluoFactory.create(AppModule, { adapter });
    activeApplications.push(app);

    await Promise.all([
      app.listen(),
      app.listen(),
      app.listen(),
    ]);

    expect(app.state).toBe('ready');
    await expect(
      adapter.GET(new Request('https://next.test/api/health')),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('loads one canonical backend for concurrent first requests', async () => {
    const { adapter } = await createTestBackend();
    let resolveAdapter:
      | ((adapter: NextHttpApplicationAdapter) => void)
      | undefined;
    const adapterPromise = new Promise<NextHttpApplicationAdapter>((resolve) => {
      resolveAdapter = resolve;
    });
    let loadCount = 0;
    const handlers = createNextAppRouterHandler(() => {
      loadCount += 1;
      return adapterPromise;
    });
    expect(Object.keys(handlers).sort()).toEqual([
      'DELETE',
      'GET',
      'HEAD',
      'OPTIONS',
      'PATCH',
      'POST',
      'PUT',
    ]);
    expect(new Set(Object.values(handlers))).toHaveLength(1);

    expect(loadCount).toBe(0);
    const responses = [
      handlers.GET(new Request('https://next.test/api/health')),
      handlers.GET(new Request('https://next.test/api/health')),
      handlers.GET(new Request('https://next.test/api/health')),
    ];

    expect(loadCount).toBe(1);
    if (!resolveAdapter) {
      throw new Error('Adapter resolver was not initialized.');
    }
    resolveAdapter(adapter);
    const resolvedResponses: Response[] = await Promise.all(responses);
    expect(resolvedResponses.map((response) => response.status)).toEqual([
      200,
      200,
      200,
    ]);
  });

  it('keeps backend startup rejection sticky', async () => {
    const startupError = new Error('backend startup failed');
    let loadCount = 0;
    const handlers = createNextAppRouterHandler(async () => {
      loadCount += 1;
      throw startupError;
    });

    const first = handlers.GET(new Request('https://next.test/api/health'));
    const second = handlers.POST(new Request('https://next.test/api/health'));

    await expect(first).rejects.toBe(startupError);
    await expect(second).rejects.toBe(startupError);
    expect(loadCount).toBe(1);
  });

  it('stops adapter requests when the Fluo application closes', async () => {
    const { adapter, app } = await createTestBackend();

    await app.close('test shutdown');

    const response = await adapter.GET(
      new Request('https://next.test/api/health'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'next_backend_adapter_closed',
      status: 503,
    });
  });
});
