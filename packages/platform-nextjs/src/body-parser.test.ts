import { Module } from '@fluojs/core';
import {
  BadRequestException, Controller, type BodyParser, type BodyParserContext,
  type GuardContext, Post, type RequestContext, UnauthorizedException, UseGuards,
} from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';
import bodyParserCases from '../../../tooling/testing/body-parser-cases.json';
import { createNextAdapter, createNextAppRouterHandler } from './adapter.js';

class AuthGuard {
  canActivate({ requestContext }: GuardContext) {
    if (requestContext.request.headers.authorization !== 'Bearer test') throw new UnauthorizedException();
    return true;
  }
}

@Controller('/posts')
class PostsController {
  @Post('/text')
  text(_input: undefined, { request }: RequestContext) {
    return { body: request.body, mime: request.headers['content-type'], raw: Array.from(request.rawBody ?? []) };
  }

  @Post('/auth')
  @UseGuards(AuthGuard)
  authenticated(_input: undefined, { request }: RequestContext) {
    if (typeof request.body !== 'string') throw new BadRequestException();
    try { return { parsed: JSON.parse(request.body) }; }
    catch { throw new BadRequestException('Invalid post JSON'); }
  }
}

@Module({ controllers: [PostsController], providers: [AuthGuard] })
class PostsModule {}

describe('Next bounded body parser conformance', () => {
  it.each(bodyParserCases)('preserves %j and %s through the App Router facade', async (body, mime) => {
    const adapter = createNextAdapter({ bodyParser: 'text', rawBody: true });
    const app = await FluoFactory.create(PostsModule, { adapter });
    try {
      await app.listen();
      const handler = createNextAppRouterHandler(async () => adapter);
      const request = new Request('https://next.test/posts/text', {
        method: 'POST', body, headers: { 'content-type': mime },
      });
      const clone = vi.spyOn(request, 'clone');
      const response = await handler.POST(request);
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ body, mime, raw: Array.from(new TextEncoder().encode(body)) });
      expect(request.headers.get('content-type')).toBe(mime);
      expect(clone).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(true);
      await expect(request.text()).rejects.toBeInstanceOf(TypeError);
    } finally { await app.close(); }
  });

  it.each([
    [undefined, undefined, 400], ['text', undefined, 401], ['text', 'Bearer test', 400],
  ] as const)('makes the auth/JSON boundary explicit for %s and %s', async (bodyParser, authorization, status) => {
    const adapter = createNextAdapter({ bodyParser });
    const app = await FluoFactory.create(PostsModule, { adapter });
    try {
      await app.listen();
      const response = await adapter.POST(new Request('https://next.test/posts/auth', {
        method: 'POST', body: '{',
        headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
      }));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { status } });
    } finally { await app.close(); }
  });

  it('runs a custom per-path parser before guards, without bypassing byte limits', async () => {
    const bodyParser: BodyParser = vi.fn((text: string, context: BodyParserContext) => {
      if (context.path === '/posts/auth') throw new BadRequestException('Parser precedes auth');
      return { custom: text };
    });
    const adapter = createNextAdapter({ bodyParser, maxBodySize: 3 });
    const app = await FluoFactory.create(PostsModule, { adapter });
    try {
      await app.listen();
      for (const [path, body, status] of [['text', '한', 201], ['text', '한a', 413], ['auth', '{', 400]] as const) {
        const response = await adapter.POST(new Request(`https://next.test/posts/${path}`, {
          method: 'POST', body, headers: { 'content-type': 'application/json' },
        }));
        expect(response.status).toBe(status);
        if (status === 201) await expect(response.json()).resolves.toMatchObject({ body: { custom: '한' } });
      }
      expect(bodyParser).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
});
