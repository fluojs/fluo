import { describe, expect, it } from 'vitest';

import {
  Controller,
  Get,
  Post,
  SseResponse,
  type RequestContext,
} from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';

import {
  bootstrapCloudflareWorkerApplication,
  type CloudflareWorkerExecutionContext,
} from './adapter.js';

function createExecutionContext(): CloudflareWorkerExecutionContext {
  return {
    waitUntil() {},
  };
}

function decodeUtf8(input: Uint8Array | undefined): string {
  return new TextDecoder().decode(input ?? new Uint8Array());
}

describe('Cloudflare Workers adapter portability smoke tests', () => {
  it('preserves malformed cookie values without crashing or normalizing them away', async () => {
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

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, { cors: false });

    try {
      const response = await worker.fetch(
        new Request('https://worker.test/cookies', {
          headers: {
            cookie: 'good=hello%20world; bad=%E0%A4%A',
          },
        }),
        {},
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        bad: '%E0%A4%A',
        good: 'hello world',
      });
    } finally {
      await worker.close();
    }
  });

  it('preserves rawBody for JSON and text requests when raw-body capture is enabled', async () => {
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

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, {
      cors: false,
      rawBody: true,
    });

    try {
      const [jsonResponse, textResponse] = await Promise.all([
        worker.fetch(
          new Request('https://worker.test/webhooks/json', {
            body: JSON.stringify({ provider: 'stripe' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }),
          {},
          createExecutionContext(),
        ),
        worker.fetch(
          new Request('https://worker.test/webhooks/text', {
            body: 'ping=1',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            method: 'POST',
          }),
          {},
          createExecutionContext(),
        ),
      ]);

      expect(jsonResponse.status).toBe(201);
      expect(textResponse.status).toBe(201);
      await expect(jsonResponse.json()).resolves.toEqual({
        parsed: { provider: 'stripe' },
        raw: '{"provider":"stripe"}',
      });
      await expect(textResponse.json()).resolves.toEqual({
        parsed: 'ping=1',
        raw: 'ping=1',
      });
    } finally {
      await worker.close();
    }
  });

  it('does not preserve rawBody for multipart requests', async () => {
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

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, {
      cors: false,
      rawBody: true,
    });

    try {
      const form = new FormData();
      form.set('name', 'Ada');
      form.set('payload', new Blob(['hello'], { type: 'text/plain' }), 'payload.txt');

      const response = await worker.fetch(
        new Request('https://worker.test/uploads', {
          body: form,
          method: 'POST',
        }),
        {},
        createExecutionContext(),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        body: { name: 'Ada' },
        fileCount: 1,
        hasRawBody: false,
      });
    } finally {
      await worker.close();
    }
  });

  it('supports SSE streaming with event-stream content type and stable framing', async () => {
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

    const worker = await bootstrapCloudflareWorkerApplication(AppModule, { cors: false });

    try {
      const response = await worker.fetch(
        new Request('https://worker.test/events', {
          headers: { accept: 'text/event-stream' },
        }),
        {},
        createExecutionContext(),
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(body).toContain('event: ready');
      expect(body).toContain('data: {"ready":true}');
    } finally {
      await worker.close();
    }
  });
});
