import { describe, expect, it } from 'vitest';
import { email, minLength, object, pipe, safeParse, string } from 'valibot';
import { z } from 'zod';

import { DtoValidationError } from './errors.js';
import { createSchemaValidator, createValibotSchemaValidator, createZodSchemaValidator } from './schema.js';

describe('schema validators', () => {
  it('maps zod failures to DtoValidationError issues', async () => {
    const schema = z.object({
      email: z.string().email(),
      tags: z.array(z.string().min(2)),
    });

    const validator = createZodSchemaValidator(schema);

    await expect(
      validator.transform({
        email: 'invalid',
        tags: ['ok', 'x'],
      }),
    ).rejects.toMatchObject({
      issues: [
        { code: 'INVALID_FORMAT', field: 'email' },
        { code: 'TOO_SMALL', field: 'tags[1]' },
      ],
    });
  });

  it('maps valibot failures to DtoValidationError issues', async () => {
    const schema = object({
      email: pipe(string(), email()),
      name: pipe(string(), minLength(2)),
    });

    const validator = createValibotSchemaValidator(schema, safeParse);

    await expect(
      validator.validate({
        email: 'invalid',
        name: 'x',
      }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({ field: 'email', message: expect.stringContaining('Invalid email') }),
        expect.objectContaining({ field: 'name', message: 'Invalid length: Expected >=2 but received 1' }),
      ],
    });
  });

  it('supports custom schema adapters via createSchemaValidator', async () => {
    const validator = createSchemaValidator<{ name: string }>({
      parse(value) {
        const input = value as { name?: string };

        if (typeof input?.name === 'string' && input.name.length > 0) {
          return { success: true, value: { name: input.name } };
        }

        return {
          success: false,
          issues: [
            {
              code: 'REQUIRED',
              field: 'name',
              message: 'name is required',
            },
          ],
        };
      },
    });

    await expect(validator.transform({ name: 'jane' })).resolves.toEqual({ name: 'jane' });
    await expect(validator.validate({})).rejects.toBeInstanceOf(DtoValidationError);
  });
});
