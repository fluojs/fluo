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

const identifierStart = /[\p{ID_Start}$_\\]/u;
const identifierPart = /[\p{ID_Continue}$\u200c\u200d\\]/u;
// Keywords after which a `/` starts a regular expression literal instead of a division.
const regexPrecedingKeywords = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw', 'typeof', 'void', 'yield',
]);

/**
 * Tokenizes engine-produced class source and reports whether it contains a `#name` private-name
 * token. Strings, template literal text, comments, and regular expression literals are skipped as
 * whole tokens; a `/` is a regular expression only where the previous token cannot end an operand.
 */
function sourceDeclaresPrivateMember(source: string): boolean {
  const templateBraceDepths: number[] = [];
  let braceDepth = 0;
  let regexAllowed = true;
  let afterDot = false;
  let index = 0;

  // Scans template text from `index` until its closing backtick or the next `${` substitution.
  const scanTemplate = (): void => {
    for (; index < source.length; index += 1) {
      const char = source[index];

      if (char === '\\') {
        index += 1;
      } else if (char === '`') {
        index += 1;
        regexAllowed = false;
        return;
      } else if (char === '$' && source[index + 1] === '{') {
        index += 2;
        braceDepth += 1;
        templateBraceDepths.push(braceDepth);
        regexAllowed = true;
        return;
      }
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    const wasAfterDot: boolean = afterDot;
    afterDot = false;

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end + 1;
      afterDot = wasAfterDot;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      afterDot = wasAfterDot;
    } else if (char === '/' && regexAllowed) {
      let inClass = false;

      for (index += 1; index < source.length; index += 1) {
        const regexChar = source[index];

        if (regexChar === '\\') {
          index += 1;
        } else if (regexChar === '[') {
          inClass = true;
        } else if (regexChar === ']') {
          inClass = false;
        } else if ((regexChar === '/' && !inClass) || regexChar === '\n') {
          break;
        }
      }

      index += 1;
      regexAllowed = false;
    } else if (char === '"' || char === "'") {
      for (index += 1; index < source.length && source[index] !== char; index += 1) {
        if (source[index] === '\\') {
          index += 1;
        }
      }

      index += 1;
      regexAllowed = false;
    } else if (char === '`') {
      index += 1;
      scanTemplate();
    } else if (char === '#') {
      if (identifierStart.test(next ?? '')) {
        return true;
      }

      index += 1;
      regexAllowed = true;
    } else if (identifierStart.test(char)) {
      const start = index;

      for (index += 1; index < source.length && identifierPart.test(source[index]); index += 1) {
        // Consume the identifier or keyword.
      }

      regexAllowed = !wasAfterDot && regexPrecedingKeywords.has(source.slice(start, index));
    } else if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next ?? ''))) {
      for (index += 1; index < source.length && /[\w.]/u.test(source[index]); index += 1) {
        // Consume the numeric literal body; exponent signs are separate punctuators.
      }

      regexAllowed = false;
    } else if (char === '}' && templateBraceDepths.at(-1) === braceDepth) {
      templateBraceDepths.pop();
      braceDepth -= 1;
      index += 1;
      scanTemplate();
    } else {
      if (char === '{') {
        braceDepth += 1;
      } else if (char === '}') {
        braceDepth -= 1;
      }

      if ((char === '+' || char === '-') && next === char) {
        // Postfix increment/decrement ends an operand, so a following `/` is a division.
        index += 2;
        regexAllowed = false;
        continue;
      }

      afterDot = char === '.' || (char === '?' && next === '.');
      index += afterDot && char === '?' ? 2 : 1;
      regexAllowed = char !== ')' && char !== ']';
    }
  }

  return false;
}

function declaresPrivateMembers(prototype: object | null): boolean {
  for (let current = prototype; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    const constructor = Object.getOwnPropertyDescriptor(current, 'constructor')?.value as unknown;

    if (typeof constructor !== 'function') {
      continue;
    }

    let declares = privateMemberDeclarations.get(constructor);

    if (declares === undefined) {
      declares = sourceDeclaresPrivateMember(Function.prototype.toString.call(constructor));
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
 * private slots cannot be copied onto a detached instance.
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
 * shape-specific copy, including typed array subclasses.
 *
 * @param value Value to clone through the fallback path.
 * @returns A deep clone for supported runtime shapes, or the original value for primitives/functions.
 */
export function fallbackClone<T>(value: T): T {
  return cloneFallbackValue(value, new WeakMap<object, unknown>());
}
