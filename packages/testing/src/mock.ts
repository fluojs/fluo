import type { Token } from '@fluojs/core';
import type { ValueProvider } from '@fluojs/di';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

import type { ShallowMocked } from './mock-types.js';

export type { ShallowMocked } from './mock-types.js';

/**
 * Shallow proxy mocks. Migrate `createMock(...)` to `ShallowMock.create(...)`.
 */
export class ShallowMock {
  /**
   * Preserves supplied values and lazily creates a stable `vi.fn()` for each missing property.
   * Nested objects and return values are not mocked. Supply data properties explicitly:
   * runtime reflection cannot distinguish a missing data property from a method.
   * Strict mode rejects missing properties instead of creating spies.
   */
  static create<T extends object>(
    partial: Partial<{
      [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : T[K];
    }> = {},
    options: { strict?: boolean } = {},
  ): ShallowMocked<T> {
    const autoMocks = new Map<PropertyKey, unknown>();

    return new Proxy({ ...partial } as ShallowMocked<T>, {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        if (options.strict) {
          throw new Error(
            `ShallowMock.create: strict mode — property "${String(prop)}" is not declared in the partial mock. Add it to the partial or disable strict mode.`,
          );
        }

        if (!autoMocks.has(prop)) {
          autoMocks.set(prop, vi.fn());
        }

        return autoMocks.get(prop);
      },
    });
  }
}

/**
 * Casts a function to a strongly typed Vitest mock.
 *
 * @param fn The fn.
 * @returns The as mock result.
 */
export function asMock<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  return fn as Mock<T>;
}

/**
 * Prototype-method mocks. Migrate `createDeepMock(Type)` to `PrototypeMock.create(Type)`.
 */
export class PrototypeMock {
  /**
   * Creates spies for own and inherited prototype methods, including symbol keys.
   * Does not run constructors, copy instance fields, evaluate accessors, or recurse.
   * The result is a plain test double, not an instance of the supplied class; fields
   * and arrow-function members described by `T` must be supplied manually before use.
   */
  static create<T extends object>(type: { prototype: T }): ShallowMocked<T> {
    const spies: Record<string | symbol, unknown> = {};
    const seen = new Set<PropertyKey>();

    let proto: object | null = type.prototype;
    while (proto !== null && proto !== Object.prototype) {
      for (const key of Reflect.ownKeys(proto)) {
        if (key === 'constructor' || seen.has(key)) continue;
        seen.add(key);

        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        if (descriptor && typeof descriptor.value === 'function') {
          Object.defineProperty(spies, key, {
            value: vi.fn(), enumerable: true, configurable: true, writable: true,
          });
        }
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }

    return spies as ShallowMocked<T>;
  }
}

/**
 * Creates a `useValue` provider for overriding a token in tests.
 *
 * @param token The token.
 * @param partial The partial.
 * @returns The mock token result.
 */
export function mockToken<T>(token: Token<T>, partial: Partial<T> = {}): ValueProvider<T> {
  return { provide: token, useValue: partial as T };
}
