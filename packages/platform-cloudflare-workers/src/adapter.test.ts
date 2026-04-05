import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Controller,
  Get,
  Post,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@konekti/http';
import { defineModule } from '@konekti/runtime';
import * as runtimeWeb from '@konekti/runtime/web';

import {
  bootstrapCloudflareWorkerApplication,
  createCloudflareWorkerAdapter,
  createCloudflareWorkerEntrypoint,
  type CloudflareWorkerExecutionContext,
} from './adapter.js';

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@konekti/platform-cloudflare-workers', () => {
  it('delegates Worker fetch handling to the shared web adapter core', async () => {
    const adapter = createCloudflareWorkerAdapter({ rawBody: true });
    const dispatcher = {
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(204);
      },
    };
    const sharedResponse = new Response(null, { status: 202 });
    const dispatchSpy = vi
      .spyOn(runtimeWeb, 'dispatchWebRequest')
      .mockResolvedValue(sharedResponse);

    await adapter.listen(dispatcher);

    const request = new Request('https://worker.test/hooks/stripe', {
      body: JSON.stringify({ provider: 'stripe' }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await adapter.fetch(request, {}, createExecutionContext());

    expect(response).toBe(sharedResponse);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcher,
        rawBody: true,
        request,
      }),
    );
  });

  it('boots a Worker application that reuses shared runtime middleware and Web request handling', async () => {
    @Controller('/webhooks')
    class WebhookController {
      @Post('/stripe')
      handle(_input: undefined, context: RequestContext) {
        return {
          path: context.request.path,
          raw: Buffer.from(context.request.rawBody ?? new Uint8Array()).toString('utf8'),
          userAgent: context.request.headers['user-agent'],
        };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [WebhookController],
    });

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, {
      cors: false,
      globalPrefix: '/api',
      rawBody: true,
    });

    try {
      const response = await worker.fetch(
        new Request('https://worker.test/api/webhooks/stripe', {
          body: JSON.stringify({ provider: 'stripe' }),
          headers: {
            'content-type': 'application/json',
            'user-agent': 'vitest-worker',
          },
          method: 'POST',
        }),
        {},
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        path: '/api/webhooks/stripe',
        raw: '{"provider":"stripe"}',
        userAgent: 'vitest-worker',
      });
    } finally {
      await worker.close();
    }
  });

  it('creates a lazy Worker entrypoint that bootstraps once and reuses the bound dispatcher', async () => {
    let bootstrapCount = 0;

    class StartupProbe {
      onApplicationBootstrap() {
        bootstrapCount += 1;
      }
    }

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
      providers: [StartupProbe],
    });

    const entrypoint = createCloudflareWorkerEntrypoint(AppModule, {
      cors: false,
    });

    try {
      const [first, second] = await Promise.all([
        entrypoint.fetch(new Request('https://worker.test/health'), {}, createExecutionContext()),
        entrypoint.fetch(new Request('https://worker.test/health'), {}, createExecutionContext()),
      ]);

      expect(bootstrapCount).toBe(1);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ ok: true });
      await expect(second.json()).resolves.toEqual({ ok: true });
    } finally {
      await entrypoint.close();
    }
  });
});
