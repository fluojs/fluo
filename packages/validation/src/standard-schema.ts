import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CustomClassValidator } from '@fluojs/core/request-pipeline';

import { DtoValidationError } from './errors.js';
import type { ValidationIssue } from './types.js';

/**
 * Standard Schema v1-compatible validator accepted by `ValidateClass`.
 *
 * @typeParam Input Input DTO shape consumed by the schema validator.
 * @typeParam Output Output DTO shape produced by the schema validator.
 */
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

/**
 * Detect whether a value implements the Standard Schema v1 contract.
 *
 * @param value Candidate schema value supplied to validation decorators.
 * @returns `true` when the candidate exposes a Standard Schema v1 validator.
 */
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

/**
 * Parse unknown input and return the successful Standard Schema output.
 *
 * @param schema Standard Schema v1 validator, including asynchronous validators.
 * @param value Unknown input to validate and transform.
 * @returns The exact successful output, including schema defaults and transformations.
 * @throws DtoValidationError When the schema returns a failure, including an empty issues array.
 * @throws TypeError When the schema returns neither a success value nor an issues array.
 * @remarks This opt-in materialization API does not change ValidateClass, which
 * remains validation-only. Exceptions thrown by schema implementations propagate.
 */
export async function parseStandardSchema<Input, Output>(
  schema: StandardSchemaV1Like<Input, Output>,
  value: unknown,
): Promise<Output> {
  const result = await schema['~standard'].validate(value);
  if (typeof result !== 'object' || result === null) {
    throw new TypeError('Standard Schema returned an invalid result.');
  }
  if (result.issues !== undefined) {
    if (!Array.isArray(result.issues)) {
      throw new TypeError('Standard Schema failure must contain an issues array.');
    }
    throw new DtoValidationError(
      'Standard Schema validation failed.',
      result.issues.map((issue) => toStandardValidationIssue(issue)),
    );
  }
  if (!('value' in result)) {
    throw new TypeError('Standard Schema success must contain a value.');
  }
  return result.value;
}

function isStandardSchemaFailureResult(
  result: unknown,
): result is { readonly issues?: readonly StandardSchemaIssueLike[] | unknown } {
  return typeof result === 'object' && result !== null && 'issues' in result;
}

/**
 * Adapt a Standard Schema validator to fluo class-level validation.
 *
 * @param schema Standard Schema-compatible validator definition.
 * @returns A class validator that reports normalized validation issues.
 */
export function createClassValidatorFromStandardSchema(schema: StandardSchemaV1Like): CustomClassValidator {
  return async (value: unknown) => {
    const result = await schema['~standard'].validate(value);

    if (!isStandardSchemaFailureResult(result) || result.issues === undefined) {
      return true;
    }

    if (!Array.isArray(result.issues)) {
      return [{ code: 'INVALID_SCHEMA_RESULT', message: 'Standard Schema validator returned malformed issues.' }];
    }

    return result.issues.length > 0
      ? result.issues.map((issue) => toStandardValidationIssue(issue))
      : true;
  };
}
