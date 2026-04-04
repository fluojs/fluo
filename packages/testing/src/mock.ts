import { vi } from 'vitest';
import type { Mock } from 'vitest';

import type { Token } from '@konekti/core';
import type { ValueProvider } from '@konekti/di';

import type { DeepMocked } from './types.js';

export type MockedMethods<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : T[K];
};

/**
 * Creates a proxy mock object with optional strict missing-property checks.
 */
export function createMock<T extends object>(
  partial: Partial<MockedMethods<T>> = {},
  options: { strict?: boolean } = {},
): MockedMethods<T> {
  const autoMocks = new Map<PropertyKey, unknown>();

  return new Proxy({ ...partial } as MockedMethods<T>, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }

      if (options.strict) {
        throw new Error(
          `createMock: strict mode — property "${String(prop)}" is not declared in the partial mock. Add it to the partial or disable strict mode.`,
        );
      }

      if (!autoMocks.has(prop)) {
        autoMocks.set(prop, vi.fn());
      }

      return autoMocks.get(prop);
    },
  });
}

/**
 * Casts a function to a strongly typed Vitest mock.
 */
export function asMock<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  return vi.mocked(fn);
}

/**
 * Creates a deep mock by replacing prototype methods with `vi.fn()` spies.
 */
export function createDeepMock<T extends object>(type: new (...args: unknown[]) => T): DeepMocked<T> {
  const spies: Record<string | symbol, unknown> = {};

  let proto: object | null = type.prototype as object | null;
  while (proto !== null && proto !== Object.prototype) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === 'constructor') continue;
      if (key in spies) continue;

      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor && typeof descriptor.value === 'function') {
        spies[key] = vi.fn();
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  return spies as DeepMocked<T>;
}

/**
 * Creates a `useValue` provider for overriding a token in tests.
 */
export function mockToken<T>(token: Token<T>, partial: Partial<T> = {}): ValueProvider<T> {
  return { provide: token, useValue: partial as T };
}
