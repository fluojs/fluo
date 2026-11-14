function cloneIntoDescriptorValue(
  descriptor: PropertyDescriptor,
  seen: WeakMap<object, unknown>,
): PropertyDescriptor {
  if (!('value' in descriptor)) {
    return descriptor;
  }

  return {
    ...descriptor,
    value: cloneFallbackValue(descriptor.value, seen),
  };
}

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const privateMemberDeclarations = new WeakMap<object, boolean>();

function cloneTypedArray(value: ArrayBufferView): ArrayBufferView {
  const prototype = Object.getPrototypeOf(value) as object;
  let intrinsicPrototype = prototype;

  while (Object.getPrototypeOf(intrinsicPrototype) !== typedArrayPrototype) {
    intrinsicPrototype = Object.getPrototypeOf(intrinsicPrototype) as object;
  }

  const Intrinsic = intrinsicPrototype.constructor as new (buffer: ArrayBuffer) => ArrayBufferView;
  // Avoid subclass constructors such as Node's deprecated `new Buffer(buffer)` path.
  const cloned = new Intrinsic(
    (value.buffer as ArrayBuffer).slice(value.byteOffset, value.byteOffset + value.byteLength),
  );

  if (prototype !== intrinsicPrototype) {
    Object.setPrototypeOf(cloned, prototype);
  }

  return cloned;
}

// Conservative private-name probe: any `#` followed by an identifier-start character (or a `\`
// starting a Unicode escape such as `#\u0061`) in the class source counts, without lexing strings,
// regular expressions, or comments. This can never miss a real private member; text such as
// `/#tag/` or `'#id'` is a documented false positive.
const privateNamePattern = /#[A-Za-z_$\\\u0080-\uffff]/;

function declaresPrivateMembers(prototype: object | null): boolean {
  for (let current = prototype; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    const constructor = Object.getOwnPropertyDescriptor(current, 'constructor')?.value as unknown;

    if (typeof constructor !== 'function') {
      continue;
    }

    let declares = privateMemberDeclarations.get(constructor);

    if (declares === undefined) {
      declares = privateNamePattern.test(Function.prototype.toString.call(constructor));
      privateMemberDeclarations.set(constructor, declares);
    }

    if (declares) {
      return true;
    }
  }

  return false;
}

function cloneFallbackValue<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const existing = seen.get(value);

  if (existing) {
    return existing as T;
  }

  // Private slots cannot be copied onto a new object, so keep these instances intact by reference.
  // This runs before every shape-specific path so built-in subclasses (for example typed arrays)
  // that declare private members are never rebuilt without their private state.
  if (declaresPrivateMembers(Object.getPrototypeOf(value) as object | null)) {
    seen.set(value, value);
    return value;
  }

  if (Array.isArray(value)) {
    const cloned: unknown[] = new Array(value.length);
    seen.set(value, cloned);

    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (descriptor) {
        Object.defineProperty(cloned, key, cloneIntoDescriptorValue(descriptor, seen));
      }
    }

    return cloned as T;
  }

  if (value instanceof Date) {
    const cloned = new Date(value.getTime());
    seen.set(value, cloned);
    return cloned as T;
  }

  if (value instanceof RegExp) {
    const cloned = new RegExp(value.source, value.flags);
    cloned.lastIndex = value.lastIndex;
    seen.set(value, cloned);
    return cloned as T;
  }

  if (value instanceof Map) {
    const cloned = new Map();
    seen.set(value, cloned);

    for (const [key, entryValue] of value.entries()) {
      cloned.set(cloneFallbackValue(key, seen), cloneFallbackValue(entryValue, seen));
    }

    return cloned as T;
  }

  if (value instanceof Set) {
    const cloned = new Set();
    seen.set(value, cloned);

    for (const entryValue of value.values()) {
      cloned.add(cloneFallbackValue(entryValue, seen));
    }

    return cloned as T;
  }

  if (value instanceof DataView) {
    const cloned = new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    seen.set(value, cloned);
    return cloned as T;
  }

  if (ArrayBuffer.isView(value)) {
    const cloned = cloneTypedArray(value);
    seen.set(value, cloned);
    return cloned as T;
  }

  if (value instanceof ArrayBuffer) {
    const cloned = value.slice(0);
    seen.set(value, cloned);
    return cloned as T;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  const cloned = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(value, cloned);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (descriptor) {
      Object.defineProperty(cloned, key, cloneIntoDescriptorValue(descriptor, seen));
    }
  }

  return cloned as T;
}

/**
 * Creates a deterministic deep clone with prototypes preserved at every supported nesting level.
 *
 * Uses the prototype-preserving fallback contract regardless of whether `structuredClone()` is
 * available, succeeds, or throws. Functions are returned by reference. Node `Buffer` values are
 * copied without the deprecated `Buffer()` constructor. Instances whose class or ancestor class
 * declares ECMAScript private members (`#field` or `#method()`) are returned by reference because
 * private slots cannot be copied onto a detached instance. Detection is conservative: a class counts
 * as declaring private members when its source text contains `#` followed by an identifier-start
 * character anywhere, including inside strings, regular expressions, or comments, so a class such
 * as one with a `pattern = /#tag/` field is also returned by reference instead of copied.
 *
 * @param value Value to clone.
 * @returns A detached clone for supported runtime shapes, or the original primitive/function.
 */
export function cloneWithFallback<T>(value: T): T {
  return fallbackClone(value);
}

/**
 * Creates a prototype-preserving deep clone independently of runtime `structuredClone()` support.
 *
 * Supported fallback shapes include arrays, dates, regular expressions, maps, sets, typed arrays,
 * array buffers, plain objects, and custom prototype-based instances with symbol-keyed properties
 * and circular references preserved. Typed arrays, including Node `Buffer` and other typed array
 * subclasses, keep their prototype and receive detached contents without invoking the subclass
 * constructor. Functions are returned by reference. Instances whose class or ancestor class declares
 * ECMAScript private members (`#field` or `#method()`) are returned by reference instead of as a
 * detached copy that would fail later when private state is read; this takes precedence over every
 * shape-specific copy, including typed array subclasses. Detection is conservative and never misses
 * a real private member: a class counts as declaring private members when its source text contains
 * `#` followed by an identifier-start character anywhere, including inside strings, regular
 * expressions, or comments. As a known limitation, a class whose source merely contains such text
 * (for example a `pattern = /#tag/` field or a `'#id'` string) is returned by reference instead
 * of copied.
 *
 * @param value Value to clone through the fallback path.
 * @returns A deep clone for supported runtime shapes, or the original value for primitives/functions.
 */
export function fallbackClone<T>(value: T): T {
  return cloneFallbackValue(value, new WeakMap<object, unknown>());
}
