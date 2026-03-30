import type { Constructor } from '@konekti/core';
import type { Type } from 'arktype';

import { DtoValidationError } from '../errors.js';
import type { ValidationIssue, Validator } from '../types.js';

interface ArkErrorLike {
  readonly code?: string;
  readonly message?: string;
  readonly path?: readonly PropertyKey[];
  readonly propString?: string;
}

interface ArkErrorsLike {
  readonly issues: readonly unknown[];
  readonly summary?: string;
}

type ArkTypeSchema<T> = Type<T>;

function isPropertyKeyArray(value: unknown): value is readonly PropertyKey[] {
  return Array.isArray(value) && value.every((segment) => typeof segment === 'string' || typeof segment === 'number');
}

function isArkErrorsLike(value: unknown): value is ArkErrorsLike {
  return typeof value === 'object' && value !== null && Array.isArray((value as { issues?: unknown }).issues);
}

function toArkErrorLike(value: unknown): ArkErrorLike {
  const candidate = value as {
    code?: unknown;
    message?: unknown;
    path?: unknown;
    propString?: unknown;
  };

  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    path: isPropertyKeyArray(candidate.path) ? candidate.path : undefined,
    propString: typeof candidate.propString === 'string' ? candidate.propString : undefined,
  };
}

function toFieldPath(path: readonly PropertyKey[] | undefined): string | undefined {
  if (!path || path.length === 0) {
    return undefined;
  }

  let result = '';

  for (const segment of path) {
    if (typeof segment === 'symbol') {
      continue;
    }

    if (typeof segment === 'number') {
      result += `[${String(segment)}]`;
      continue;
    }

    result += result.length === 0 ? segment : `.${segment}`;
  }

  return result.length > 0 ? result : undefined;
}

function normalizeCode(code: string | undefined, fallback: string): string {
  if (!code || code.length === 0) {
    return fallback;
  }

  return code.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || fallback;
}

function toIssues(errors: ArkErrorsLike): ValidationIssue[] {
  const issues = errors.issues.map((rawIssue) => {
    const issue = toArkErrorLike(rawIssue);

    return {
      code: normalizeCode(issue.code, 'INVALID_FIELD'),
      field: toFieldPath(issue.path) ?? issue.propString,
      message: issue.message ?? errors.summary ?? 'Invalid value.',
    };
  });

  if (issues.length > 0) {
    return issues;
  }

  return [
    {
      code: 'INVALID_FIELD',
      message: errors.summary ?? 'Invalid value.',
    },
  ];
}

async function parseWithArkType<T>(schema: ArkTypeSchema<T>, value: unknown): Promise<unknown> {
  const result = schema(value);

  if (isArkErrorsLike(result)) {
    throw new DtoValidationError('Validation failed.', toIssues(result));
  }

  return result;
}

export function createArkTypeAdapter<TSchema>(schema: ArkTypeSchema<TSchema>): Validator {
  return {
    async validate(value: unknown, _target: Constructor): Promise<void> {
      await parseWithArkType(schema, value);
    },

    async transform<TOutput>(value: unknown, _target: Constructor<TOutput>): Promise<TOutput> {
      const transformed = await parseWithArkType(schema, value);
      return transformed as unknown as TOutput;
    },
  };
}
