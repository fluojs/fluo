import { vi } from 'vitest';
import type { Mock } from 'vitest';

import type { Token } from '@konekti/core';
import type { ValueProvider } from '@konekti/di';

import type { DeepMocked } from './types.js';

export type MockedMethods<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : T[K];
};

export function createMock<T extends object>(partial: Partial<MockedMethods<T>> = {}): MockedMethods<T> {
  const autoMocks = new Map<PropertyKey, unknown>();

  return new Proxy({ ...partial } as MockedMethods<T>, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }

      if (!autoMocks.has(prop)) {
        autoMocks.set(prop, vi.fn());
      }

      return autoMocks.get(prop);
    },
  });
}

export function asMock<T extends (...args: never[]) => unknown>(fn: T): Mock<T> {
  return fn as unknown as Mock<T>;
}

export function createDeepMock<T extends object>(type: new (...args: unknown[]) => T): DeepMocked<T> {
  const spies: Record<string | symbol, unknown> = {};

  let proto: object | null = type.prototype as object | null;
  while (proto !== null && proto !== Object.prototype) {
    for (const key of Reflect.ownKeys(proto)) {
      if (key === 'constructor') continue;
      if (key in spies) continue;

      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor && typeof descriptor.value === 'function') {
        spies[key as string] = vi.fn();
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  return spies as DeepMocked<T>;
}

export function mockToken<T>(token: Token<T>, partial: Partial<T> = {}): ValueProvider<T> {
  return { provide: token, useValue: partial as T };
}
