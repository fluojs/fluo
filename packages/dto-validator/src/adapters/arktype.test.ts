import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

import { DtoValidationError } from '../errors.js';
import { createArkTypeAdapter } from './arktype.js';

class RequestPayload {}

describe('createArkTypeAdapter', () => {
  it('maps ArkType failures to ValidationIssue[]', async () => {
    const schema = type({
      email: 'string.email',
      tags: 'string[]',
    });

    const validator = createArkTypeAdapter(schema);

    try {
      await validator.validate(
        {
          email: 'invalid',
          tags: [1],
        },
        RequestPayload,
      );
      throw new Error('Expected validation to fail for invalid payload');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DtoValidationError);

      const issues = (error as DtoValidationError).issues;
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PATTERN', field: 'email' }),
          expect.objectContaining({ code: 'DOMAIN', field: 'tags[0]' }),
        ]),
      );
    }
  });

  it('passes valid input without errors', async () => {
    const schema = type({
      email: 'string.email',
      tags: 'string[]',
    });

    const validator = createArkTypeAdapter(schema);

    await expect(
      validator.transform(
        {
          email: 'hello@konekti.dev',
          tags: ['backend', 'framework'],
        },
        RequestPayload,
      ),
    ).resolves.toEqual({
      email: 'hello@konekti.dev',
      tags: ['backend', 'framework'],
    });
  });

  it('returns field and message values for invalid input', async () => {
    const schema = type({
      email: 'string.email',
    });

    const validator = createArkTypeAdapter(schema);

    try {
      await validator.validate({ email: 'broken' }, RequestPayload);
      throw new Error('Expected validation to fail for invalid email');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DtoValidationError);

      const issues = (error as DtoValidationError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        field: 'email',
      });
      expect(issues[0]?.message).toContain('email');
    }
  });
});
