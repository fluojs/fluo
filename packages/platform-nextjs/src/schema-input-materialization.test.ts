import { Module } from '@fluojs/core';
import {
  Controller,
  createSchemaDto,
  Get,
  type GuardContext,
  Head,
  Post,
  RequestDto,
  StandardSchemaBinder,
  UnauthorizedException,
  UseGuards,
} from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { createNextAppRouterHandler } from './app-router.js';
import { NextHttpApplicationAdapter } from './index.js';

describe('schema input through the public Next App Router adapter', () => {
  it('preserves bounded parsing, raw guards, native query arrays and original HEAD semantics', async () => {
    const events: string[] = [];
    const seen: Array<{
      method: string;
      body: unknown;
      bytes: number[];
      raw: unknown;
    }> = [];
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'native-input-conformance',
        async validate(value: unknown) {
          events.push('schema');
          const input = value as Record<string, unknown>;
          if (input.title !== undefined && typeof input.title !== 'string') {
            return { issues: [{ message: 'Invalid title', path: ['title'] }] };
          }
          return {
            value: {
              title: typeof input.title === 'string' ? input.title.trim() : 'Untitled',
              id: Number(input.id),
              tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
            },
          };
        },
      },
    };
    const Input = createSchemaDto(schema, {
      fields: {
        title: { source: 'body', key: 'post_title' },
        id: { source: 'path', key: 'postId' },
        tags: { source: 'query', key: 'tag' },
      },
      policy: { unknownFields: 'strip', nonObjects: 'empty' },
    });
    class Inspect {
      canActivate({ requestContext }: GuardContext) {
        events.push('guard');
        seen.push({
          method: requestContext.request.method,
          body: requestContext.request.body,
          bytes: Array.from(requestContext.request.rawBody ?? []),
          raw: requestContext.request.raw,
        });
        if (requestContext.request.headers.authorization !== 'Bearer test') {
          throw new UnauthorizedException();
        }
        return true;
      }
    }
    @Controller('/posts')
    @UseGuards(Inspect)
    class Posts {
      @Post('/:postId')
      @RequestDto(Input)
      create(input: InstanceType<typeof Input>) {
        events.push('post');
        return input;
      }

      @Get('/:postId')
      @RequestDto(Input)
      get(input: InstanceType<typeof Input>) {
        events.push('get');
        return input;
      }

      @Get('/explicit/:postId')
      @RequestDto(Input)
      explicitGet(input: InstanceType<typeof Input>) {
        events.push('explicit-get');
        return input;
      }

      @Head('/explicit/:postId')
      @RequestDto(Input)
      explicitHead(input: InstanceType<typeof Input>) {
        events.push('explicit-head');
        return input;
      }
    }
    @Module({ controllers: [Posts], providers: [Inspect] })
    class App {}
    const adapter = NextHttpApplicationAdapter.create({
      headRouting: 'explicit-or-get',
      rawBody: true,
      maxBodySize: 128,
      bodyParser(_text, parserContext) {
        events.push('parse');
        return parserContext.parseDefault();
      },
    });
    const app = await FluoFactory.create(App, {
      adapter,
      binder: (fallback) => new StandardSchemaBinder(fallback),
    });
    try {
      await app.listen();
      const handler = createNextAppRouterHandler(async () => adapter);
      const wire = '{"post_title":"  Draft  ","extra":true}';
      const native = new Request('https://schema.test/posts/9?tag=a&tag=b', {
        method: 'POST',
        body: wire,
        headers: {
          authorization: 'Bearer test',
          'content-type': 'application/json',
        },
      });
      const clone = vi.spyOn(native, 'clone');
      const response = await handler.POST(native);
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        title: 'Draft', id: 9, tags: ['a', 'b'],
      });
      expect(events).toEqual(['parse', 'guard', 'schema', 'post']);
      expect(seen[0]).toMatchObject({
        method: 'POST',
        body: { post_title: '  Draft  ', extra: true },
        bytes: Array.from(new TextEncoder().encode(wire)),
      });
      expect(seen[0]?.raw).toBe(native);
      expect(native.headers.get('content-type')).toBe('application/json');
      expect(native.bodyUsed).toBe(true);
      expect(clone).not.toHaveBeenCalled();
      clone.mockRestore();

      for (const [body, status, expectedEvents] of [
        ['{', 400, ['parse']],
        ['x'.repeat(129), 413, []],
      ] as const) {
        events.length = 0;
        const failed = await handler.POST(new Request('https://schema.test/posts/9', {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
        }));
        expect(failed.status).toBe(status);
        expect(events).toEqual(expectedEvents);
      }

      events.length = 0;
      const unauthorized = await handler.POST(new Request('https://schema.test/posts/9', {
        method: 'POST',
        body: '{"post_title":"Draft","extra":true}',
        headers: { 'content-type': 'application/json' },
      }));
      expect(unauthorized.status).toBe(401);
      expect(events).toEqual(['parse', 'guard']);

      events.length = 0;
      const dangerous = await handler.POST(new Request('https://schema.test/posts/9', {
        method: 'POST',
        body: '{"post_title":"Draft","__proto__":"blocked"}',
        headers: {
          authorization: 'Bearer test',
          'content-type': 'application/json',
        },
      }));
      expect(dangerous.status).toBe(400);
      await expect(dangerous.json()).resolves.toMatchObject({
        error: {
          details: [expect.objectContaining({ code: 'DANGEROUS_KEY', field: '__proto__' })],
        },
      });
      expect(events).toEqual(['parse', 'guard']);

      events.length = 0;
      const invalid = await handler.POST(new Request('https://schema.test/posts/9', {
        method: 'POST',
        body: '{"post_title":123}',
        headers: {
          authorization: 'Bearer test',
          'content-type': 'application/json',
        },
      }));
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({
        error: {
          details: [expect.objectContaining({ code: 'INVALID_FIELD', field: 'title' })],
        },
      });
      expect(events).toEqual(['parse', 'guard', 'schema']);

      events.length = 0;
      const empty = await handler.POST(new Request('https://schema.test/posts/9', {
        method: 'POST',
        body: '[]',
        headers: {
          authorization: 'Bearer test',
          'content-type': 'application/json',
        },
      }));
      expect(empty.status).toBe(201);
      await expect(empty.json()).resolves.toEqual({ title: 'Untitled', id: 9, tags: [] });
      expect(seen.at(-1)?.body).toEqual([]);
      expect(events).toEqual(['parse', 'guard', 'schema', 'post']);

      for (const [path, selected] of [
        ['/posts/9', 'get'],
        ['/posts/explicit/9', 'explicit-head'],
      ] as const) {
        events.length = 0;
        const head = await handler.HEAD(new Request(`https://schema.test${path}`, {
          method: 'HEAD',
          headers: { authorization: 'Bearer test' },
        }));
        expect(head.status).toBe(200);
        await expect(head.text()).resolves.toBe('');
        expect(seen.at(-1)?.method).toBe('HEAD');
        expect(seen.at(-1)?.body).toBeUndefined();
        expect(events).toEqual(['guard', 'schema', selected]);
      }
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });
});
