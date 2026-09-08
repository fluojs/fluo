import { type Constructor, InvariantError } from '@fluojs/core';
import type { StandardSchemaV1Like } from '@fluojs/validation';
import { describe, expect, it } from 'vitest';

import { DefaultBinder } from './adapters/binding.js';
import {
  Controller,
  createHandlerMapping,
  createSchemaDto,
  FromBody,
  InputPolicy,
  Optional,
  Post,
  RequestDto,
  StandardSchemaBinder,
  type ArgumentResolverContext,
  type FrameworkRequest,
  type SchemaBindingField,
} from './index.js';
import * as portable from './index.portable.js';

function context(
  body: unknown,
  overrides: Partial<FrameworkRequest> = {},
): ArgumentResolverContext {
  return {
    handler: {
      controllerToken: class ControllerToken {},
      methodName: 'create',
      metadata: {
        controllerPath: '/',
        effectivePath: '/',
        moduleMiddleware: [],
        pathParams: [],
      },
      route: { method: 'POST', path: '/' },
    },
    requestContext: {
      container: {
        async dispose() {},
        async resolve() {
          throw new Error('Unexpected DI resolution');
        },
      },
      metadata: {},
      request: {
        body,
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/',
        query: {},
        raw: undefined,
        url: '/',
        ...overrides,
      },
      response: {
        committed: false,
        headers: {},
        statusCode: undefined,
        statusSet: false,
        redirect() {},
        send() {},
        setHeader() {},
        setStatus() {},
      },
    },
  };
}

const echo: StandardSchemaV1Like<unknown, Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'fluo-test',
    validate: (value) => ({ value: value as Record<string, unknown> }),
  },
};

describe('independent HTTP input policies', () => {
  it('exports the same APIs through root and portable entry points', () => {
    expect(portable.InputPolicy).toBe(InputPolicy);
    expect(portable.createSchemaDto).toBe(createSchemaDto);
    expect(portable.StandardSchemaBinder).toBe(StandardSchemaBinder);
  });

  it('keeps strict defaults and isolates inherited policy overrides', async () => {
    class Strict {
      @FromBody('post_title')
      title = '';
    }
    @InputPolicy({ unknownFields: 'strip' })
    class Projected extends Strict {}
    @InputPolicy({ unknownFields: 'reject' })
    class StrictAgain extends Projected {}

    const binder = new DefaultBinder();
    for (const dto of [Strict, StrictAgain]) {
      await expect(binder.bind(dto, context({ post_title: 'Draft', extra: true })))
        .rejects.toMatchObject({
          status: 400,
          details: [expect.objectContaining({ code: 'UNKNOWN_FIELD', field: 'extra' })],
        });
    }
    await expect(binder.bind(Projected, context({ post_title: 'Draft', extra: true })))
      .resolves.toEqual({ title: 'Draft' });
  });

  it.each([[], ['bad'], 'text', 42, false])(
    'requires an explicit non-object-to-empty policy for %j',
    async (body) => {
      class Strict {
        @FromBody()
        @Optional()
        title = 'default';
      }
      @InputPolicy({ nonObjects: 'empty' })
      class Empty extends Strict {}

      await expect(new DefaultBinder().bind(Strict, context(body)))
        .rejects.toMatchObject({
          status: 400,
          details: [expect.objectContaining({ code: 'INVALID_BODY' })],
        });
      const incoming = context(body);
      await expect(new DefaultBinder().bind(Empty, incoming))
        .resolves.toEqual({ title: 'default' });
      expect(incoming.requestContext.request.body).toBe(body);
    },
  );

  it('preserves null/absent-body handling and required binding semantics', async () => {
    class OptionalInput {
      @FromBody()
      @Optional()
      title = 'default';
    }
    @InputPolicy({ nonObjects: 'empty' })
    class Required {
      @FromBody()
      title = 'initializer-is-not-a-binding-default';
    }
    for (const body of [undefined, null]) {
      await expect(new DefaultBinder().bind(OptionalInput, context(body)))
        .resolves.toEqual({ title: 'default' });
    }
    for (const body of [undefined, null, []]) {
      await expect(new DefaultBinder().bind(Required, context(body)))
        .rejects.toMatchObject({
          details: [expect.objectContaining({ code: 'MISSING_FIELD', field: 'title' })],
        });
    }
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'never strips or empties dangerous own key %s',
    async (key) => {
      @InputPolicy({ unknownFields: 'strip', nonObjects: 'empty' })
      class Projected {
        @FromBody()
        @Optional()
        title = '';
      }
      const SchemaInput = createSchemaDto(echo, {
        fields: { title: { source: 'body' } },
        policy: { unknownFields: 'strip', nonObjects: 'empty' },
      });
      const array: unknown[] = [];
      Object.defineProperty(array, key, { enumerable: true, value: 'blocked' });
      expect(Object.hasOwn(array, key)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(array, key)).toMatchObject({
        enumerable: true,
        value: 'blocked',
      });

      for (const body of [{ title: 'Draft', [key]: 'blocked' }, array]) {
        await expect(new DefaultBinder().bind(Projected, context(body)))
          .rejects.toMatchObject({
            status: 400,
            details: [expect.objectContaining({ code: 'DANGEROUS_KEY', field: key })],
          });
        await expect(new StandardSchemaBinder().bind(SchemaInput, context(body)))
          .rejects.toMatchObject({
            status: 400,
            details: [expect.objectContaining({ code: 'DANGEROUS_KEY', field: key })],
          });
      }
    },
  );

  it('composes route decorators in either order without changing DTO identity or sibling policies', async () => {
    @InputPolicy({ unknownFields: 'strip' })
    class Input {
      @FromBody('post_title')
      title = '';
    }
    function StrictPost(value: Function, decoratorContext: ClassMethodDecoratorContext) {
      InputPolicy({ unknownFields: 'reject' })(value, decoratorContext);
      RequestDto(Input)(value, decoratorContext);
      Post('/strict')(value, decoratorContext);
    }
    @Controller('/posts')
    class Routes {
      @StrictPost
      strict() {}

      @InputPolicy({ unknownFields: 'strip' })
      @RequestDto(Input)
      @Post('/projected')
      projected() {}

      @Post('/reversed')
      @RequestDto(Input)
      @InputPolicy({ unknownFields: 'reject' })
      reversed() {}

      @Post('/legacy')
      @RequestDto(Input)
      legacy() {}
    }
    InputPolicy({ unknownFields: 'reject' })(
      Routes.prototype,
      'legacy',
      Object.getOwnPropertyDescriptor(Routes.prototype, 'legacy'),
    );

    const mapping = createHandlerMapping([{ controllerToken: Routes }]);
    expect(mapping.descriptors).toHaveLength(4);
    for (const handler of mapping.descriptors) {
      expect(handler.route.request).toBe(Input);
      const incoming = context({ post_title: 'Draft', extra: true });
      incoming.handler = handler;
      const bound = new DefaultBinder().bind(Input, incoming);
      if (handler.methodName === 'projected') {
        await expect(bound).resolves.toEqual({ title: 'Draft' });
      } else {
        await expect(bound).rejects.toMatchObject({ status: 400 });
      }
    }
  });

  it('rejects invalid JavaScript policy values during declaration', () => {
    expect(() => Reflect.apply(InputPolicy, undefined, [{ unknownFields: 'allow' }]))
      .toThrow(TypeError);
    expect(() => Reflect.apply(InputPolicy, undefined, [{ nonObjects: 'ignore' }]))
      .toThrow(TypeError);
  });
});

describe('Standard Schema binding', () => {
  it.each(['preserve', 'first', 'last', 'reject'] as const)(
    'defines repeated query policy %s without mutating the query',
    async (repeatedQuery) => {
      const Input = createSchemaDto(echo, {
        fields: { tags: { source: 'query', key: 'tag', repeatedQuery } },
      });
      const incoming = context(undefined, { query: { tag: ['a', 'b'] } });
      const original = incoming.requestContext.request.query.tag;
      const bound = new StandardSchemaBinder().bind(Input, incoming);
      if (repeatedQuery === 'reject') {
        await expect(bound).rejects.toMatchObject({
          status: 400,
          details: [expect.objectContaining({
            code: 'REPEATED_QUERY',
            field: 'tags',
            source: 'query',
          })],
        });
      } else {
        await expect(bound).resolves.toEqual({
          tags: repeatedQuery === 'preserve' ? ['a', 'b'] : repeatedQuery === 'first' ? 'a' : 'b',
        });
      }
      expect(incoming.requestContext.request.query.tag).toBe(original);
      expect(original).toEqual(['a', 'b']);
    },
  );

  it('preserves default query shapes and omits absent mappings', async () => {
    const Input = createSchemaDto(echo, {
      fields: { tags: { source: 'query', key: 'tag' } },
    });
    const binder = new StandardSchemaBinder();
    await expect(binder.bind(Input, context(undefined))).resolves.toEqual({});
    await expect(binder.bind(Input, context(undefined, { query: { tag: 'a', extra: 'ignored' } })))
      .resolves.toEqual({ tags: 'a' });
    const incoming = context(undefined, { query: { tag: ['a', 'b'] } });
    const output = await binder.bind(Input, incoming);
    expect(output).toEqual({ tags: ['a', 'b'] });
    if (typeof output !== 'object' || output === null || !('tags' in output)) {
      throw new Error('Expected the mapped schema output');
    }
    expect(output.tags).not.toBe(incoming.requestContext.request.query.tag);
  });

  it('snapshots mappings and policies and lets the schema own missing fields and defaults', async () => {
    const fields: Record<string, SchemaBindingField> = {
      title: { source: 'body', key: 'post_title' },
      id: { source: 'path', key: 'postId' },
    };
    const policy: {
      unknownFields: 'strip' | 'reject';
      nonObjects: 'empty' | 'reject';
    } = { unknownFields: 'strip', nonObjects: 'empty' };
    const schema: StandardSchemaV1Like<unknown, { title: string; id: number }> = {
      '~standard': {
        version: 1,
        vendor: 'fluo-test',
        async validate(value) {
          const input = value as Record<string, unknown>;
          return {
            value: {
              title: typeof input.title === 'string' ? input.title.trim() : 'Untitled',
              id: Number(input.id),
            },
          };
        },
      },
    };
    const Input = createSchemaDto(schema, { fields, policy });
    fields.title = { source: 'query', key: 'changed' };
    policy.unknownFields = 'reject';
    policy.nonObjects = 'reject';
    const binder = new StandardSchemaBinder();
    await expect(binder.bind(Input, context(
      { post_title: '  Draft  ', extra: true },
      { params: { postId: '7' } },
    ))).resolves.toEqual({ title: 'Draft', id: 7 });
    await expect(binder.bind(Input, context([], { params: { postId: '8' } })))
      .resolves.toEqual({ title: 'Untitled', id: 8 });
    expect(() => new Input()).toThrow(InvariantError);
  });

  it('retains strict body defaults for schema tokens', async () => {
    const Input = createSchemaDto(echo, { fields: { title: { source: 'body' } } });
    const binder = new StandardSchemaBinder();
    await expect(binder.bind(Input, context({ title: 'Draft', extra: true })))
      .rejects.toMatchObject({
        status: 400,
        details: [expect.objectContaining({ code: 'UNKNOWN_FIELD', field: 'extra' })],
      });
    await expect(binder.bind(Input, context([]))).rejects.toMatchObject({
      status: 400,
      details: [expect.objectContaining({ code: 'INVALID_BODY' })],
    });
  });

  it('normalizes schema issue paths into HTTP 400 and propagates implementation failures', async () => {
    const failure: StandardSchemaV1Like = {
      '~standard': {
        version: 1,
        vendor: 'fluo-test',
        validate: () => ({
          issues: [{ message: 'Invalid title', path: ['posts', { key: 0 }, 'title'] }],
        }),
      },
    };
    const Input = createSchemaDto(failure, { fields: {} });
    await expect(new StandardSchemaBinder().bind(Input, context(undefined)))
      .rejects.toMatchObject({
        status: 400,
        details: [expect.objectContaining({ code: 'INVALID_FIELD', field: 'posts[0].title' })],
      });

    const error = new Error('schema implementation failed');
    const Throwing = createSchemaDto({
      '~standard': {
        version: 1,
        vendor: 'fluo-test',
        validate() { throw error; },
      },
    }, { fields: {} });
    await expect(new StandardSchemaBinder().bind(Throwing, context(undefined)))
      .rejects.toBe(error);
  });

  it('treats an empty Standard Schema issues array as HTTP 400, not success or a server error', async () => {
    const Input = createSchemaDto({
      '~standard': {
        version: 1,
        vendor: 'fluo-test',
        validate: () => ({ issues: [] }),
      },
    }, { fields: {} });
    await expect(new StandardSchemaBinder().bind(Input, context(undefined)))
      .rejects.toMatchObject({ status: 400, details: [] });
  });

  it('delegates ordinary DTOs to the supplied Binder with the original context', async () => {
    class Ordinary {}
    const incoming = context(undefined);
    const calls: Array<[Constructor, ArgumentResolverContext]> = [];
    const result = new Ordinary();
    const binder = new StandardSchemaBinder({
      bind(dto, supplied) {
        calls.push([dto, supplied]);
        return result;
      },
    });
    await expect(binder.bind(Ordinary, incoming)).resolves.toBe(result);
    expect(calls).toEqual([[Ordinary, incoming]]);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects dangerous mapping key %s before handling requests',
    (key) => {
      expect(() => createSchemaDto(echo, {
        fields: { [key]: { source: 'body', key: 'safe' } },
      })).toThrow(TypeError);
      expect(() => createSchemaDto(echo, {
        fields: { safe: { source: 'body', key } },
      })).toThrow(TypeError);
    },
  );
});
