import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import * as v from 'valibot';

import {
  DefaultValidator,
  DtoValidationError,
  parseStandardSchema,
  ValidateClass,
  type StandardSchemaV1Like,
} from './index.js';

describe('explicit Standard Schema output parsing', () => {
  it('returns inferred transformed output and defaults without changing ValidateClass', async () => {
    const schema = z.object({
      title: z.string().trim(),
      count: z.coerce.number().default(2),
    });
    const parsed = parseStandardSchema(schema, { title: '  Draft  ' });
    expectTypeOf(parsed).toEqualTypeOf<Promise<{ title: string; count: number }>>();
    await expect(parsed).resolves.toEqual({ title: 'Draft', count: 2 });

    @ValidateClass(schema)
    class Input {
      title = '  Draft  ';
    }
    const input = new Input();
    await new DefaultValidator().validate(input, Input);
    expect(input.title).toBe('  Draft  ');
    expect(Object.hasOwn(input, 'count')).toBe(false);
  });

  it('supports another Standard Schema vendor and asynchronous transforms', async () => {
    const valibot = v.pipe(v.string(), v.trim());
    await expect(parseStandardSchema(valibot, '  Draft  ')).resolves.toBe('Draft');
    const asyncSchema = z.string().transform(async (value) => ({ length: value.length }));
    await expect(parseStandardSchema(asyncSchema, 'post')).resolves.toEqual({ length: 4 });
  });

  it('returns schema issues, including nested paths, as DtoValidationError', async () => {
    await expect(parseStandardSchema(
      z.object({ posts: z.array(z.object({ title: z.string() })) }),
      { posts: [{ title: 1 }] },
    )).rejects.toMatchObject({
      name: 'DtoValidationError',
      issues: [expect.objectContaining({ field: 'posts[0].title' })],
    });
  });

  it('rejects valid empty-issues failures while preserving ValidateClass compatibility', async () => {
    const schema: StandardSchemaV1Like = {
      '~standard': {
        version: 1,
        vendor: 'fluo-test',
        validate: () => ({ issues: [] }),
      },
    };
    const failed = parseStandardSchema(schema, {});
    await expect(failed).rejects.toBeInstanceOf(DtoValidationError);
    await expect(failed).rejects.toMatchObject({ issues: [] });

    @ValidateClass(schema)
    class Input {
      title = 'unchanged';
    }
    const input = new Input();
    await expect(new DefaultValidator().validate(input, Input)).resolves.toBeUndefined();
    expect(input.title).toBe('unchanged');
  });

  it.each([undefined, null, {}, { issues: 'invalid' }])(
    'rejects malformed success/failure result %j instead of fabricating output',
    async (result) => {
      const schema = {
        '~standard': { version: 1, vendor: 'fluo-test', validate: () => result },
      };
      await expect(Reflect.apply(parseStandardSchema, undefined, [schema, {}]))
        .rejects.toBeInstanceOf(TypeError);
    },
  );

  it('preserves successful undefined output and thrown schema failures', async () => {
    const schema: StandardSchemaV1Like<unknown, undefined> = {
      '~standard': { version: 1, vendor: 'fluo-test', validate: () => ({ value: undefined }) },
    };
    await expect(parseStandardSchema(schema, {})).resolves.toBeUndefined();
    const error = new Error('schema failure');
    await expect(parseStandardSchema({
      '~standard': { version: 1, vendor: 'fluo-test', validate() { throw error; } },
    }, {})).rejects.toBe(error);
  });
});
