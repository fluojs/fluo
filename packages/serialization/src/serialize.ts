import type { MetadataPropertyKey } from '@fluojs/core';

import { getClassSerializationOptions, getFieldSerializationMetadata, type SerializationFieldMetadata } from './metadata.js';

interface SerializationContext {
  metadataCache: WeakMap<Function, { classOptions: ReturnType<typeof getClassSerializationOptions>; fieldMetadata: ReturnType<typeof getFieldSerializationMetadata> }>;
  references: WeakMap<object, { active: boolean; value: unknown }>;
}

function isObjectLike(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOpaqueObject(value: object): boolean {
  return (
    value instanceof Date
    || value instanceof Map
    || value instanceof Set
    || value instanceof WeakMap
    || value instanceof WeakSet
    || value instanceof URL
    || value instanceof URLSearchParams
    || value instanceof RegExp
    || value instanceof Error
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || value instanceof Promise
    || (typeof Blob === 'function' && value instanceof Blob)
    || (typeof ReadableStream === 'function' && value instanceof ReadableStream)
    || hasOpaqueBrand(value)
  );
}

function hasInternalSlot(probe: (this: object) => unknown, value: object): boolean {
  try {
    probe.call(value);
    return true;
  } catch {
    return false;
  }
}

const getRegExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!;
const getArrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const probeMap = function (this: object) { return Map.prototype.has.call(this, undefined); };
const probeSet = function (this: object) { return Set.prototype.has.call(this, undefined); };
const probeWeakMap = function (this: object) { return WeakMap.prototype.has.call(this, {}); };
const probeWeakSet = function (this: object) { return WeakSet.prototype.has.call(this, {}); };

/**
 * `Object.prototype.toString` reports `[object Error]` from the `[[ErrorData]]` slot only when no string
 * `Symbol.toStringTag` overrides it, so a missing string tag confirms a genuine (possibly cross-realm) error.
 */
function hasErrorBrand(value: object): boolean {
  return typeof Reflect.get(value, Symbol.toStringTag) !== 'string';
}

type PromiseBrandHost = typeof globalThis & {
  process?: {
    getBuiltinModule?(id: 'node:util'): { types?: { isPromise?(value: unknown): boolean } } | undefined;
  };
};

function resolveIsPromise(): ((value: unknown) => boolean) | undefined {
  try {
    return (globalThis as PromiseBrandHost).process?.getBuiltinModule?.('node:util')?.types?.isPromise;
  } catch {
    return undefined;
  }
}

const isPromiseBrand = resolveIsPromise();

/**
 * Realm-safe brand checks keyed by `Object.prototype.toString` tags. Tags only
 * select a candidate; built-ins with internal slots are confirmed by invoking a
 * side-effect-free intrinsic so a DTO that merely spoofs `Symbol.toStringTag`
 * is still walked as a record.
 */
const opaqueBrandChecks = new Map<string, (value: object) => boolean>([
  ['[object Date]', (value) => hasInternalSlot(Date.prototype.getTime, value)],
  ['[object Map]', (value) => hasInternalSlot(probeMap, value)],
  ['[object Set]', (value) => hasInternalSlot(probeSet, value)],
  ['[object WeakMap]', (value) => hasInternalSlot(probeWeakMap, value)],
  ['[object WeakSet]', (value) => hasInternalSlot(probeWeakSet, value)],
  ['[object RegExp]', (value) => hasInternalSlot(getRegExpSource, value)],
  ['[object ArrayBuffer]', (value) => hasInternalSlot(getArrayBufferByteLength, value)],
  ['[object Error]', hasErrorBrand],
  ['[object Promise]', (value) => isPromiseBrand?.(value) === true],
]);

function hasOpaqueBrand(value: object): boolean {
  const check = opaqueBrandChecks.get(Object.prototype.toString.call(value));
  return check !== undefined && check(value);
}

function hasCallableToJSON(value: Record<string | symbol, unknown>): boolean {
  return typeof value.toJSON === 'function';
}

function getSerializableConstructor(value: Record<string | symbol, unknown>): Function | undefined {
  const prototype = Object.getPrototypeOf(value);

  if (prototype === null || prototype === Object.prototype) {
    return undefined;
  }

  const constructor = Reflect.get(prototype, 'constructor');
  return typeof constructor === 'function' ? constructor : undefined;
}

function applyTransforms(value: unknown, metadata: SerializationFieldMetadata): unknown {
  let transformed = value;

  for (const transform of metadata.transforms ?? []) {
    transformed = transform(transformed);
  }

  return transformed;
}

function assignSerializedProperty(
  target: Record<string | symbol, unknown>,
  propertyKey: string | symbol,
  value: unknown,
): void {
  if (propertyKey === '__proto__' || propertyKey === 'constructor' || propertyKey === 'prototype') {
    Object.defineProperty(target, propertyKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    return;
  }

  target[propertyKey] = value;
}

function getEnumerableOwnSymbolKeys(value: Record<string | symbol, unknown>): symbol[] {
  return Object.getOwnPropertySymbols(value).filter((key) => (
    Object.prototype.propertyIsEnumerable.call(value, key)
  ));
}

function resolveCandidateKeys(
  value: Record<string | symbol, unknown>,
  fieldMetadata: Map<MetadataPropertyKey, SerializationFieldMetadata>,
  excludeExtraneous: boolean,
): MetadataPropertyKey[] {
  if (excludeExtraneous) {
    return [...fieldMetadata.entries()]
      .filter(([, metadata]) => metadata.exposed === true)
      .map(([propertyKey]) => propertyKey);
  }

  const keys = new Set<MetadataPropertyKey>([
    ...Object.keys(value),
    ...getEnumerableOwnSymbolKeys(value),
  ]);

  for (const [propertyKey, metadata] of fieldMetadata) {
    if (metadata.exposed === true) {
      keys.add(propertyKey);
    }
  }

  return [...keys];
}

function getCachedMetadata(
  constructor: Function,
  context: SerializationContext,
): { classOptions: ReturnType<typeof getClassSerializationOptions>; fieldMetadata: ReturnType<typeof getFieldSerializationMetadata> } {
  const cached = context.metadataCache.get(constructor);

  if (cached) {
    return cached;
  }

  const next = {
    classOptions: getClassSerializationOptions(constructor),
    fieldMetadata: getFieldSerializationMetadata(constructor),
  };

  context.metadataCache.set(constructor, next);
  return next;
}

function getCircularOrSharedValue(value: object, context: SerializationContext): unknown {
  const cached = context.references.get(value);

  if (!cached) {
    return undefined;
  }

  if (cached.active) {
    return undefined;
  }

  return cached.value;
}

function markSerializationStart(value: object, serialized: unknown, context: SerializationContext): void {
  context.references.set(value, {
    active: true,
    value: serialized,
  });
}

function markSerializationComplete(value: object, context: SerializationContext): void {
  const cached = context.references.get(value);

  if (!cached) {
    return;
  }

  cached.active = false;
}

function serializeWithTrackedReference<TSerialized>(
  value: object,
  context: SerializationContext,
  create: () => TSerialized,
  fill: (serialized: TSerialized) => void,
): TSerialized {
  const cachedValue = getCircularOrSharedValue(value, context);

  if (context.references.has(value)) {
    return cachedValue as TSerialized;
  }

  const serialized = create();
  markSerializationStart(value, serialized, context);

  try {
    fill(serialized);
    return serialized;
  } finally {
    markSerializationComplete(value, context);
  }
}

function serializeClassInstance(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  const constructor = getSerializableConstructor(value);

  if (!constructor) {
    return serializeRecord(value, context);
  }

  const { classOptions, fieldMetadata } = getCachedMetadata(constructor, context);
  const hasMetadata = fieldMetadata.size > 0 || Object.hasOwn(classOptions, 'excludeExtraneous');

  if (!hasMetadata) {
    return hasCallableToJSON(value) ? value : serializeRecord(value, context);
  }

  return serializeWithTrackedReference<Record<string | symbol, unknown>>(value, context, () => ({}), (serialized) => {
    const candidateKeys = resolveCandidateKeys(value, fieldMetadata, classOptions.excludeExtraneous === true);

    for (const propertyKey of candidateKeys) {
      const metadata = fieldMetadata.get(propertyKey);

      if (metadata?.excluded) {
        continue;
      }

      const raw = value[propertyKey as keyof typeof value];

      if (raw === undefined && classOptions.excludeExtraneous === true && metadata?.exposed !== true) {
        continue;
      }

      const transformed = metadata ? applyTransforms(raw, metadata) : raw;
      assignSerializedProperty(serialized, propertyKey, serializeInternal(transformed, context));
    }
  });
}

function serializeRecord(
  value: Record<string | symbol, unknown>,
  context: SerializationContext,
): Record<string | symbol, unknown> {
  const symbolKeys = getEnumerableOwnSymbolKeys(value);
  const keys: Array<string | symbol> = [...Object.keys(value), ...symbolKeys];

  return serializeWithTrackedReference<Record<string | symbol, unknown>>(value, context, () => ({}), (serialized) => {
    for (const propertyKey of keys) {
      const propertyValue = value[propertyKey];
      assignSerializedProperty(serialized, propertyKey, serializeInternal(propertyValue, context));
    }
  });
}

function serializeInternal<T = unknown>(value: T, context: SerializationContext): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return serializeWithTrackedReference<unknown[]>(value, context, () => [], (serialized) => {
      for (const item of value) {
        serialized.push(serializeInternal(item, context));
      }
    });
  }

  if (isObjectLike(value)) {
    if (isOpaqueObject(value)) {
      return value;
    }

    if (isPlainObject(value)) {
      return serializeRecord(value, context);
    }

    return serializeClassInstance(value, context);
  }

  return value;
}

/**
 * Serializes class instances, arrays, plain records, and mixed object graphs
 * into plain response-shaped values.
 *
 * Serialization honors `@Expose()`, `@Exclude()`, and `@Transform()` metadata.
 * Cycles and repeated references are handled without unbounded recursion across
 * both object and array boundaries. Active cycles are cut to `undefined`, while
 * completed shared references reuse the previously serialized value.
 * Opaque built-ins and non-JSON leaf values such as `Date`, `Map`, `Set`, `URL`, `Error`, `bigint`, functions, and symbols pass through unchanged unless you normalize them before or during serialization.
 * Built-ins are recognized realm-safely, so values created in another realm (for example through `node:vm`) also pass through,
 * as do `ReadableStream` and `Blob` values. Undecorated class instances that define a callable `toJSON()` pass through so the
 * final JSON writer applies their own representation; classes with serialization metadata keep metadata-driven shaping.
 *
 * @typeParam T Input value type.
 * @param value Value or object graph to serialize.
 * @returns A plain recursively serialized structure whose opaque objects and non-JSON leaf values are preserved unless transformed.
 *
 * @example
 * ```ts
 * class UserEntity {
 *   id = '1';
 * }
 *
 * serialize(new UserEntity());
 * ```
 */
export function serialize<T = unknown>(value: T): unknown {
  const context: SerializationContext = {
    metadataCache: new WeakMap(),
    references: new WeakMap(),
  };

  return serializeInternal(value, context);
}
