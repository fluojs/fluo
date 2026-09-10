import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { Module, Scope } from '@fluojs/core';
import {
  All,
  BadRequestException,
  Controller,
  Convert,
  createByteRangeResponse,
  FromBody,
  FromCookie,
  FromPath,
  FromQuery,
  Get,
  type GuardContext,
  Head,
  HttpCode,
  type MiddlewareContext,
  type Next,
  Post,
  type RequestContext,
  RequestDto,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@fluojs/http';
import { NextHttpApplicationAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';

const sentinel = process.env.FLUO_E2E_BOOTSTRAP;
if (!sentinel) {
  throw new Error('FLUO_E2E_BOOTSTRAP is required.');
}
const instance = randomUUID();
const record = (event: string) => {
  appendFileSync(sentinel, `${JSON.stringify({
    event, instance, phase: process.env.FLUO_E2E_PHASE, pid: process.pid,
  })}\n`);
};
record('start');
if (process.env.FLUO_E2E_PHASE === 'build') {
  throw new Error('Fluo bootstrap ran while Next collected routes.');
}
if (process.env.FLUO_E2E_FAIL_BOOTSTRAP === '1') {
  throw new Error('FLUO_E2E_EXPECTED_BOOTSTRAP_FAILURE');
}

class NumberConverter {
  convert(value: unknown) {
    return Number(value);
  }
}

class SessionConverter {
  convert(value: unknown) {
    return `converted:${String(value)}`;
  }
}

// Field decorators intentionally require the packaged TC39 Babel loader.
class BoundRequest {
  @FromPath('facade')
  facade = '';

  @FromQuery('count')
  @Convert(NumberConverter)
  count = 0;

  @FromCookie('session')
  @Convert(SessionConverter)
  session = '';

  @FromBody('message')
  message = '';
}

const streams = new Map<string, () => void>();
const headCounts = new Map<string, number>();

function countHead(context: RequestContext, stage: string) {
  const id = context.request.headers['x-head-id'];
  if (typeof id !== 'string') return;
  const key = `${id}:${stage}`;
  const count = (headCounts.get(key) ?? 0) + 1;
  headCounts.set(key, count);
  context.response.setHeader(`x-${stage}-count`, String(count));
}

class BodyAuthGuard {
  canActivate({ requestContext }: GuardContext) {
    if (requestContext.request.headers.authorization !== 'Bearer fixture') {
      throw new UnauthorizedException();
    }
    return true;
  }
}

class HeadGuard {
  canActivate({ requestContext }: GuardContext) {
    countHead(requestContext, 'guard');
    requestContext.response.setHeader('x-guard-method', requestContext.request.method);
    return true;
  }
}

class HeadMiddleware {
  async handle({ requestContext }: MiddlewareContext, next: Next) {
    countHead(requestContext, 'middleware');
    await next();
  }
}

function headResult(context: RequestContext, selected: string, status = 200) {
  countHead(context, 'controller');
  context.response.setHeader('x-selected', selected);
  context.response.setHeader('x-handler-method', context.request.method);
  context.response.setHeader('set-cookie', ['head-first=1; Path=/', 'head-second=2; Path=/']);
  context.response.setStatus(status);
  return { selected };
}

@Controller('/api/:facade')
@UseGuards(HeadGuard)
class BackendController {
  @Get('/head-get')
  headGet(_input: undefined, context: RequestContext) { return headResult(context, 'get'); }

  @Get('/head-explicit')
  explicitGet(_input: undefined, context: RequestContext) { return headResult(context, 'wrong-get'); }

  @Head('/head-explicit')
  explicitHead(_input: undefined, context: RequestContext) { return headResult(context, 'head', 202); }

  @Get('/head-all')
  allGet(_input: undefined, context: RequestContext) { return headResult(context, 'wrong-all-get'); }

  @All('/head-all')
  allHead(_input: undefined, context: RequestContext) { return headResult(context, 'all', 203); }

  @Get('/head-get-404')
  get404(_input: undefined, context: RequestContext) { return headResult(context, 'get-404', 404); }

  @Get('/head-explicit-404')
  wrongRetry(_input: undefined, context: RequestContext) { return headResult(context, 'wrong-retry'); }

  @Head('/head-explicit-404')
  explicit404(_input: undefined, context: RequestContext) { return headResult(context, 'head-404', 404); }

  @Get('/head-bytes')
  bytes() {
    return createByteRangeResponse(new TextEncoder().encode('hello'), { contentType: 'text/plain' });
  }

  @Get('/health')
  health() {
    return { status: 'ok', instance };
  }

  @Head('/health')
  healthHead() {
    return { status: 'ok', instance };
  }

  @Post('/bounded-text')
  boundedText(_input: undefined, { request }: RequestContext) {
    return {
      body: request.body,
      mime: request.headers['content-type'],
      raw: Array.from(request.rawBody ?? []),
      consumed: (request.raw as Request).bodyUsed,
    };
  }

  @Post('/bounded-custom')
  boundedCustom(_input: undefined, { request }: RequestContext) {
    return { body: request.body };
  }

  @Post('/bounded-auth')
  @UseGuards(BodyAuthGuard)
  boundedAuth(_input: undefined, { request }: RequestContext) {
    if (typeof request.body !== 'string') throw new BadRequestException();
    try { return { body: JSON.parse(request.body) }; }
    catch { throw new BadRequestException('Invalid post JSON'); }
  }

  @Post('/echo')
  @HttpCode(201)
  echo(_input: undefined, context: RequestContext) {
    return { body: context.request.body };
  }

  @Post('/binding')
  @HttpCode(201)
  @RequestDto(BoundRequest)
  binding(input: BoundRequest, context: RequestContext) {
    context.response.setHeader('set-cookie', [
      'session=rotated; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    return {
      facade: input.facade,
      count: input.count,
      session: input.session,
      message: input.message,
    };
  }

  @Sse('/stream/:id')
  async *stream(_input: undefined, context: RequestContext) {
    const id = context.request.params['id'];
    if (!id) {
      throw new Error('Stream id is required.');
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    const signal = context.request.signal;
    const onAbort = () => resolve();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) resolve();
    streams.set(id, resolve);
    try {
      yield { event: 'chunk', data: { sequence: 1 } };
      await promise;
      if (!signal?.aborted) {
        yield { event: 'chunk', data: { sequence: 2 } };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      streams.delete(id);
      console.log(`FLUO_E2E_STREAM_CLOSED ${id}`);
    }
  }

  @Post('/stream/:id/release')
  @HttpCode(202)
  release(_input: undefined, context: RequestContext) {
    const release = streams.get(context.request.params['id'] ?? '');
    if (!release) {
      return { released: false };
    }
    release();
    return { released: true };
  }
}

@Scope('request')
@Controller('/api/:facade')
class HeadStreamController {
  private id = '';

  @Sse('/head-stream/:id')
  stream(_input: undefined, context: RequestContext): AsyncIterable<string> {
    this.id = context.request.params.id;
    const id = this.id;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          async return() {
            console.log(`FLUO_E2E_HEAD_STREAM_RETURN ${id}`);
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  onDestroy() {
    console.log(`FLUO_E2E_HEAD_SCOPE_DISPOSED ${this.id}`);
  }
}

@Module({
  controllers: [BackendController, HeadStreamController],
  providers: [NumberConverter, SessionConverter, HeadGuard, HeadMiddleware, BodyAuthGuard],
})
class BackendModule {}

// No Content-Type rewrite, Request reconstruction, or parser outside the adapter.
export const nextAdapter = NextHttpApplicationAdapter.create({
  headRouting: 'explicit-or-get',
  maxBodySize: 128,
  rawBody: true,
  bodyParser(text, context) {
    if (context.path.endsWith('/bounded-custom')) return { custom: text };
    if (context.path.includes('/bounded-')) return text;
    return context.parseDefault();
  },
});
const app = await FluoFactory.create(BackendModule, {
  adapter: nextAdapter,
  middleware: [HeadMiddleware],
});
await app.listen();
record('ready');
