import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { Module } from '@fluojs/core';
import {
  Controller,
  Convert,
  FromBody,
  FromCookie,
  FromPath,
  FromQuery,
  Get,
  Head,
  HttpCode,
  Post,
  type RequestContext,
  RequestDto,
  Sse,
} from '@fluojs/http';
import { createNextAdapter } from '@fluojs/platform-nextjs';
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

@Controller('/api/:facade')
class BackendController {
  @Get('/health')
  health() {
    return { status: 'ok', instance };
  }

  @Head('/health')
  healthHead() {
    return { status: 'ok', instance };
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

@Module({
  controllers: [BackendController],
  providers: [NumberConverter, SessionConverter],
})
class BackendModule {}

export const nextAdapter = createNextAdapter();
const app = await FluoFactory.create(BackendModule, { adapter: nextAdapter });
await app.listen();
record('ready');
