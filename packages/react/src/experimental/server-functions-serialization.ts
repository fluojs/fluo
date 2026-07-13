import type { ReactServerFunctionValue } from './server-functions-types.js';

const blockedObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);

type SerializationFailure = {
  readonly ok: false;
  readonly path: string;
  readonly reason: string;
};

type SerializationSuccess<T> = {
  readonly ok: true;
  readonly value: T;
};

/** Result of parsing an untrusted value into the Server Function serialization subset. */
export type ReactServerFunctionSerializationResult<T> =
  | SerializationSuccess<T>
  | SerializationFailure;

type ParseContext = {
  readonly ancestors: Set<object>;
  readonly depth: number;
  readonly maxDepth: number;
  readonly path: string;
};

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failure(path: string, reason: string): SerializationFailure {
  return { ok: false, path, reason };
}

function parseArray(value: readonly unknown[], context: ParseContext): ReactServerFunctionSerializationResult<ReactServerFunctionValue> {
  if (context.ancestors.has(value)) {
    return failure(context.path, 'Circular arrays are not serializable.');
  }
  context.ancestors.add(value);
  const parsed: ReactServerFunctionValue[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      context.ancestors.delete(value);
      return failure(`${context.path}[${String(index)}]`, 'Sparse arrays are not serializable.');
    }
    const item: unknown = value[index];
    const result = parseValue(item, {
      ancestors: context.ancestors,
      depth: context.depth + 1,
      maxDepth: context.maxDepth,
      path: `${context.path}[${String(index)}]`,
    });
    if (!result.ok) {
      context.ancestors.delete(value);
      return result;
    }
    parsed.push(result.value);
  }

  context.ancestors.delete(value);
  return { ok: true, value: Object.freeze(parsed) };
}

function parseRecord(
  value: Readonly<Record<string, unknown>>,
  context: ParseContext,
): ReactServerFunctionSerializationResult<ReactServerFunctionValue> {
  if (context.ancestors.has(value)) {
    return failure(context.path, 'Circular objects are not serializable.');
  }
  if (Reflect.ownKeys(value).length !== Object.keys(value).length) {
    return failure(context.path, 'Symbol and non-enumerable properties are not serializable.');
  }
  context.ancestors.add(value);
  const parsed: Record<string, ReactServerFunctionValue> = {};
  Object.setPrototypeOf(parsed, null);

  for (const [key, item] of Object.entries(value)) {
    if (blockedObjectKeys.has(key)) {
      context.ancestors.delete(value);
      return failure(`${context.path}.${key}`, 'Prototype-sensitive object keys are not allowed.');
    }
    const result = parseValue(item, {
      ancestors: context.ancestors,
      depth: context.depth + 1,
      maxDepth: context.maxDepth,
      path: `${context.path}.${key}`,
    });
    if (!result.ok) {
      context.ancestors.delete(value);
      return result;
    }
    parsed[key] = result.value;
  }

  context.ancestors.delete(value);
  return { ok: true, value: Object.freeze(parsed) };
}

function parseValue(
  value: unknown,
  context: ParseContext,
): ReactServerFunctionSerializationResult<ReactServerFunctionValue> {
  if (context.depth > context.maxDepth) {
    return failure(context.path, `Serialization depth exceeds ${String(context.maxDepth)}.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : failure(context.path, 'Only finite numbers are serializable.');
  }
  if (Array.isArray(value)) {
    return parseArray(value, context);
  }
  if (isPlainRecord(value)) {
    return parseRecord(value, context);
  }
  return failure(context.path, 'Only JSON-compatible primitives, arrays, and plain objects are serializable.');
}

/**
 * Parses an untrusted argument list into an immutable JSON-compatible snapshot.
 *
 * @param value Unknown request argument value.
 * @param maxDepth Maximum supported nesting depth.
 * @returns A parsed argument list or a deterministic path and reason.
 */
export function parseReactServerFunctionArguments(
  value: unknown,
  maxDepth: number,
): ReactServerFunctionSerializationResult<readonly ReactServerFunctionValue[]> {
  if (!Array.isArray(value)) {
    return failure('args', 'Server Function arguments must be an array.');
  }
  const parsed = parseArray(value, {
    ancestors: new Set(),
    depth: 0,
    maxDepth,
    path: 'args',
  });
  if (!parsed.ok) {
    return parsed;
  }
  return Array.isArray(parsed.value)
    ? { ok: true, value: parsed.value }
    : failure('args', 'Server Function arguments must be an array.');
}

/**
 * Parses one untrusted action result into an immutable JSON-compatible snapshot.
 *
 * @param value Unknown action result.
 * @param maxDepth Maximum supported nesting depth.
 * @returns A parsed result or a deterministic path and reason.
 */
export function parseReactServerFunctionValue(
  value: unknown,
  maxDepth: number,
): ReactServerFunctionSerializationResult<ReactServerFunctionValue> {
  return parseValue(value, {
    ancestors: new Set(),
    depth: 0,
    maxDepth,
    path: 'result',
  });
}

/**
 * Measures the UTF-8 JSON representation of an already parsed Server Function value.
 *
 * @param value JSON-compatible value produced by this module.
 * @returns Encoded byte length.
 */
export function measureReactServerFunctionValue(value: ReactServerFunctionValue): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : new TextEncoder().encode(serialized).byteLength;
}
