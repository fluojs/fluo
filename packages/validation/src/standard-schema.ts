import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CustomClassValidator } from '@konekti/core';

import type { ValidationIssue } from './types.js';

export type StandardSchemaV1Like<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

type StandardSchemaPathSegmentLike = StandardSchemaV1.PathSegment;

type StandardSchemaIssueLike = StandardSchemaV1.Issue & {
  readonly code?: string;
  readonly kind?: string;
  readonly propString?: string;
  readonly type?: string;
};

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

  return result;
}

function normalizeCode(code: string | undefined, fallback: string): string {
  if (!code || code.length === 0) {
    return fallback;
  }

  return code.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || fallback;
}

export function isStandardSchemaLike(value: unknown): value is StandardSchemaV1Like {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }

  const standard = (value as { '~standard'?: unknown })['~standard'];

  if (typeof standard !== 'object' || standard === null) {
    return false;
  }

  const candidate = standard as {
    validate?: unknown;
    vendor?: unknown;
    version?: unknown;
  };

  return candidate.version === 1 && typeof candidate.vendor === 'string' && typeof candidate.validate === 'function';
}

function toStandardSchemaPath(
  path: readonly (PropertyKey | StandardSchemaPathSegmentLike)[] | undefined,
): readonly PropertyKey[] | undefined {
  if (!path || path.length === 0) {
    return undefined;
  }

  const segments: PropertyKey[] = [];

  for (const segment of path) {
    if (typeof segment === 'string' || typeof segment === 'number') {
      segments.push(segment);
      continue;
    }

    if (
      typeof segment === 'object'
      && segment !== null
      && 'key' in segment
      && (typeof segment.key === 'string' || typeof segment.key === 'number' || typeof segment.key === 'symbol')
    ) {
      segments.push(segment.key);
    }
  }

  return segments.length > 0 ? segments : undefined;
}

function toStandardValidationIssue(issue: StandardSchemaIssueLike): ValidationIssue {
  return {
    code: normalizeCode(issue.code ?? issue.kind ?? issue.type, 'INVALID_FIELD'),
    field: toFieldPath(toStandardSchemaPath(issue.path)) ?? issue.propString,
    message: issue.message,
  };
}

export function createClassValidatorFromStandardSchema(schema: StandardSchemaV1Like): CustomClassValidator {
  return async (value) => {
    const result = await schema['~standard'].validate(value);

    if (Array.isArray(result.issues)) {
      return result.issues.length > 0
        ? result.issues.map((issue) => toStandardValidationIssue(issue))
        : [{ code: 'INVALID_FIELD', message: 'Invalid value.' }];
    }

    return true;
  };
}
