import type { MaybePromise } from '@konekti/core';

import { DtoValidationError } from './errors.js';
import type { ValidationIssue } from './types.js';

export type SchemaValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: readonly ValidationIssue[] };

export interface SchemaValidationAdapter<T> {
  parse(value: unknown): MaybePromise<SchemaValidationResult<T>>;
}

export interface SchemaValidator<T> {
  validate(value: unknown): MaybePromise<void>;
  transform(value: unknown): MaybePromise<T>;
}

interface ZodIssueLike {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly PropertyKey[];
}

interface ZodSafeParseFailureLike {
  readonly success: false;
  readonly error: {
    readonly issues: readonly ZodIssueLike[];
  };
}

interface ZodSafeParseSuccessLike<T> {
  readonly success: true;
  readonly data: T;
}

interface ZodSchemaLike<T> {
  safeParse(value: unknown): ZodSafeParseSuccessLike<T> | ZodSafeParseFailureLike;
}

type ValibotPathLike =
  | string
  | number
  | {
      readonly key?: string | number;
    };

interface ValibotIssueLike {
  readonly message: string;
  readonly path?: readonly ValibotPathLike[];
  readonly kind?: string;
  readonly type?: string;
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

  return result;
}

function normalizeCode(code: string | undefined, fallback: string): string {
  if (!code || code.length === 0) {
    return fallback;
  }

  return code.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || fallback;
}

function toValidationError(issues: readonly ValidationIssue[]): never {
  throw new DtoValidationError('Validation failed.', issues);
}

function toValibotPath(path: readonly ValibotPathLike[] | undefined): readonly PropertyKey[] | undefined {
  if (!path || path.length === 0) {
    return undefined;
  }

  const segments: PropertyKey[] = [];

  for (const segment of path) {
    if (typeof segment === 'string' || typeof segment === 'number') {
      segments.push(segment);
      continue;
    }

    if (segment && (typeof segment.key === 'string' || typeof segment.key === 'number')) {
      segments.push(segment.key);
    }
  }

  return segments.length > 0 ? segments : undefined;
}

function toValibotIssue(issue: unknown): ValibotIssueLike {
  const candidate = issue as {
    kind?: unknown;
    message?: unknown;
    path?: unknown;
    type?: unknown;
  };

  return {
    kind: typeof candidate.kind === 'string' ? candidate.kind : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : 'Invalid value.',
    path: Array.isArray(candidate.path) ? (candidate.path as readonly ValibotPathLike[]) : undefined,
    type: typeof candidate.type === 'string' ? candidate.type : undefined,
  };
}

export function createSchemaValidator<T>(adapter: SchemaValidationAdapter<T>): SchemaValidator<T> {
  return {
    async validate(value: unknown): Promise<void> {
      const result = await adapter.parse(value);

      if (!result.success) {
        toValidationError(result.issues);
      }
    },

    async transform(value: unknown): Promise<T> {
      const result = await adapter.parse(value);

      if (!result.success) {
        toValidationError(result.issues);
      }

      return result.value;
    },
  };
}

export function createZodSchemaValidator<T>(schema: ZodSchemaLike<T>): SchemaValidator<T> {
  return createSchemaValidator<T>({
    parse(value: unknown): SchemaValidationResult<T> {
      const result = schema.safeParse(value);

      if (result.success) {
        return { success: true, value: result.data };
      }

      return {
        success: false,
        issues: result.error.issues.map((issue) => ({
          code: normalizeCode(issue.code, 'INVALID_FIELD'),
          field: toFieldPath(issue.path),
          message: issue.message,
        })),
      };
    },
  });
}

export function createValibotSchemaValidator<T, TSchema>(
  schema: TSchema,
  safeParse: (schema: TSchema, value: unknown) => {
    readonly success: boolean;
    readonly output?: unknown;
    readonly issues?: readonly unknown[];
  },
): SchemaValidator<T> {
  return createSchemaValidator<T>({
    parse(value: unknown): SchemaValidationResult<T> {
      const result = safeParse(schema, value);

      if (result.success) {
        return { success: true, value: result.output as T };
      }

      return {
        success: false,
        issues: (result.issues ?? []).map((rawIssue) => {
          const issue = toValibotIssue(rawIssue);

          return {
          code: normalizeCode(issue.kind ?? issue.type, 'INVALID_FIELD'),
          field: toFieldPath(toValibotPath(issue.path)),
          message: issue.message,
          };
        }),
      };
    },
  });
}
