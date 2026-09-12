import { Inject, Module, publicToken } from '@fluojs/core';
import {
  Controller,
  Convert,
  createSchemaDto,
  FromBody,
  FromQuery,
  Get,
  InputPolicy,
  Post,
  RequestDto,
  StandardSchemaBinder,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type Converter,
  type GuardContext,
  type InterceptorContext,
} from '@fluojs/http';
import { IsInt, ValidateClass, type StandardSchemaV1Like } from '@fluojs/validation';
import { describe, expect, it } from 'vitest';

import { withCleanup } from '../../../tooling/testing/with-cleanup.js';
import { Test } from './index.js';
import type { TestResponse } from './http.js';

function observeSchemaEntry(events: EventTarget): {
  promise: Promise<void>;
  cancel(): void;
} {
  let cancel: () => void = () => {
    throw new Error('Schema entry observation was not initialized');
  };
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      events.removeEventListener('schema-entry', onEntry);
    };
    const onEntry = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for schema entry'));
    }, 2_000);
    events.addEventListener('schema-entry', onEntry, { once: true });
    cancel = () => {
      cleanup();
      resolve();
    };
  });
  return { promise, cancel: () => cancel() };
}

describe('blog input materialization through the application boundary', () => {
  it('projects class DTOs without installing a schema binder and validates only projected aliases', async () => {
    const validated: unknown[] = [];
    @InputPolicy({ unknownFields: 'strip' })
    @ValidateClass((value: unknown) => { validated.push(value); return true; })
    class Input {
      @FromBody('post_title')
      title = '';
    }
    @Controller('/posts')
    class Posts {
      @Post()
      @RequestDto(Input)
      create(input: Input) {
        return input;
      }
    }
    @Module({ controllers: [Posts] })
    class App {}
    const app = await Test.createApp({ rootModule: App });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const response = await app.request('POST', '/posts')
        .body({ post_title: 'Draft', authorId: 'untrusted' }).send();
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ title: 'Draft' });
      expect(validated).toEqual([{ title: 'Draft' }]);
    });
  });

  it('replaces projection/context workarounds while retaining guards, aliases, converters and async order', async () => {
    const events: string[] = [];
    const originalBodies: unknown[] = [];
    const schemaEvents = new EventTarget();
    let release: () => void = () => {
      throw new Error('Schema gate was not initialized');
    };
    const gate = new Promise<void>((resolve) => { release = resolve; });
    type Command = { title: string; count: number; id: number; tags: string[] };
    const schema: StandardSchemaV1Like<unknown, Command> = {
      '~standard': {
        version: 1,
        vendor: 'blog-conformance',
        async validate(value) {
          events.push('schema');
          schemaEvents.dispatchEvent(new Event('schema-entry'));
          await gate;
          const input = value as Record<string, unknown>;
          if (typeof input.title !== 'string') {
            return { issues: [{ message: 'Title is required', path: ['title'] }] };
          }
          return {
            value: {
              title: input.title.trim(),
              count: input.count === undefined ? 1 : Number(input.count),
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
        count: { source: 'body' },
        id: { source: 'path', key: 'postId' },
        tags: { source: 'query', key: 'tag' },
      },
      policy: { unknownFields: 'strip' },
    });
    class PostsService {
      save(input: Command) {
        events.push('service');
        return { ...input, authorId: 'server-owned' };
      }
    }
    class TwiceConverter implements Converter {
      convert(value: unknown) {
        expect(value).toBeTypeOf('number');
        return Number(value) * 2;
      }
    }
    const postsToken = publicToken<PostsService>(`test/3716/posts/${crypto.randomUUID()}`);
    const converterToken = publicToken<Converter>(`test/3716/converter/${crypto.randomUUID()}`);
    class LegacyInput {
      @FromQuery('page')
      @Convert(converterToken)
      @IsInt()
      page = 0;
    }
    class Auth {
      canActivate({ requestContext }: GuardContext) {
        events.push('guard');
        originalBodies.push(requestContext.request.body);
        if (requestContext.request.headers.authorization !== 'Bearer test') {
          throw new UnauthorizedException();
        }
        return true;
      }
    }
    class Around {
      async intercept(_context: InterceptorContext, next: CallHandler) {
        events.push('interceptor:before');
        const result = await next.handle();
        events.push('interceptor:after');
        return result;
      }
    }
    @Controller('/posts')
    @Inject(postsToken)
    class Posts {
      constructor(private readonly posts: PostsService) {}

      @Post('/:postId')
      @RequestDto(Input)
      @UseGuards(Auth)
      @UseInterceptors(Around)
      create(input: InstanceType<typeof Input>) {
        events.push('handler');
        return this.posts.save(input);
      }

      @Get('/legacy')
      @RequestDto(LegacyInput)
      legacy(input: LegacyInput) {
        return input;
      }
    }
    @Module({
      controllers: [Posts],
      providers: [
        PostsService, TwiceConverter, Auth, Around,
        { provide: postsToken, useExisting: PostsService },
        { provide: converterToken, useExisting: TwiceConverter },
      ],
    })
    class App {}
    let factories = 0;
    const app = await Test.createApp({
      rootModule: App,
      converters: [{ convert: (value) => Number(value) }],
      binder(defaultBinder) {
        factories += 1;
        return new StandardSchemaBinder(defaultBinder);
      },
    });
    await withCleanup(async (defer) => {
      defer(() => app.close());
      const entry = observeSchemaEntry(schemaEvents);
      let pending: Promise<TestResponse> | undefined;
      defer(() => pending);
      defer(() => release());
      defer(() => entry.cancel());
      const body = Object.freeze({ post_title: '  Draft  ', authorId: 'untrusted' });
      pending = app.request('POST', '/posts/7')
        .header('authorization', 'Bearer test')
        .query('tag', ['a', 'b'])
        .body(body).send();
      await entry.promise;
      expect(events).toEqual(['guard', 'interceptor:before', 'schema']);
      expect(originalBodies).toEqual([body]);
      expect(originalBodies[0]).toBe(body);
      release();
      const response = await pending;
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        title: 'Draft', count: 1, id: 7, tags: ['a', 'b'], authorId: 'server-owned',
      });
      expect(events).toEqual([
        'guard', 'interceptor:before', 'schema', 'handler', 'service', 'interceptor:after',
      ]);

      events.length = 0;
      const unauthorized = await app.request('POST', '/posts/7')
        .body({ ['constructor']: 'blocked' }).send();
      expect(unauthorized.status).toBe(401);
      expect(events).toEqual(['guard']);

      events.length = 0;
      const dangerous = await app.request('POST', '/posts/7')
        .header('authorization', 'Bearer test')
        .body({ post_title: 'Draft', ['__proto__']: 'blocked' }).send();
      expect(dangerous.status).toBe(400);
      expect(dangerous.body).toMatchObject({
        error: { details: [expect.objectContaining({ code: 'DANGEROUS_KEY', field: '__proto__' })] },
      });
      expect(events).toEqual(['guard', 'interceptor:before']);

      events.length = 0;
      const invalid = await app.request('POST', '/posts/7')
        .header('authorization', 'Bearer test').body({}).send();
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({
        error: { details: [expect.objectContaining({ code: 'INVALID_FIELD', field: 'title' })] },
      });
      expect(events).toEqual(['guard', 'interceptor:before', 'schema']);

      const coerced = await app.request('POST', '/posts/8')
        .header('authorization', 'Bearer test')
        .body({ post_title: '  Next  ', count: '2' }).send();
      expect(coerced.status).toBe(201);
      expect(coerced.body).toEqual({
        title: 'Next', count: 2, id: 8, tags: [], authorId: 'server-owned',
      });

      const legacy = await app.request('GET', '/posts/legacy').query('page', '3').send();
      expect(legacy.status).toBe(200);
      expect(legacy.body).toEqual({ page: 6 });
      expect(factories).toBe(1);
    });
  }, 5_000);
});
