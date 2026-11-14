import { getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it, vi } from 'vitest';

import { CacheModule } from './module.js';
import { MemoryStore } from './stores/memory-store.js';
import { CACHE_OPTIONS } from './tokens.js';
import type { CacheModuleOptions, NormalizedCacheModuleOptions } from './types.js';

describe('CacheModule.forRoot', () => {
  it.each([undefined, 'throw', 'bypass'] as const)('normalizes rememberCacheErrors %s', (rememberCacheErrors) => {
    const providers = getModuleMetadata(CacheModule.forRoot({ rememberCacheErrors }))?.providers ?? [];

    expect(providers).toContainEqual({
      provide: CACHE_OPTIONS,
      useValue: expect.objectContaining({ rememberCacheErrors: rememberCacheErrors ?? 'throw' }),
    });
  });

  it.each([null, '', 'ignore', false, 0, {}, []])('rejects invalid rememberCacheErrors %j during registration', (value) => {
    const options: CacheModuleOptions = {};
    Object.defineProperty(options, 'rememberCacheErrors', { enumerable: true, value });

    expect(() => CacheModule.forRoot(options)).toThrow(/rememberCacheErrors.*"throw".*"bypass"/);
  });

  it.each(['mongo', ''])('rejects unsupported store %j during registration', (store) => {
    const options: CacheModuleOptions = {};
    Object.defineProperty(options, 'store', { enumerable: true, value: store });

    expect(() => CacheModule.forRoot(options)).toThrow(/store.*"memory".*"redis"/);
  });

  describe.each(['get', 'set', 'del', 'reset'] as const)('custom store %s', (method) => {
    it.each(['missing', 'non-callable'])('rejects a %s method during registration', (kind) => {
      const operation = vi.fn(async () => undefined);
      const store = { get: operation, set: operation, del: operation, reset: operation };
      if (kind === 'missing') {
        Reflect.deleteProperty(store, method);
      } else {
        Object.defineProperty(store, method, { value: 42 });
      }

      expect(() => CacheModule.forRoot({ store })).toThrow(new RegExp(`store.*${method}`));
      expect(operation).not.toHaveBeenCalled();
    });
  });

  it('rejects an empty custom store with all missing method names', () => {
    const options: CacheModuleOptions = {};
    Object.defineProperty(options, 'store', { enumerable: true, value: {} });

    expect(() => CacheModule.forRoot(options)).toThrow(/store.*get.*set.*del.*reset/);
  });

  it.each(['plain', 'prototype'])('accepts a %s store without invoking operations or validating optional hooks', (kind) => {
    const operation = vi.fn(async () => undefined);
    const store = kind === 'plain'
      ? { get: operation, set: operation, del: operation, reset: operation }
      : new MemoryStore();
    for (const method of ['close', 'dispose', 'atomicUpdate']) {
      Object.defineProperty(store, method, {
        get: () => {
          throw new Error(`Registration must not inspect optional ${method}.`);
        },
      });
    }

    const providers = getModuleMetadata(CacheModule.forRoot({ store }))?.providers ?? [];

    expect(providers).toContainEqual({
      provide: CACHE_OPTIONS,
      useValue: expect.objectContaining({ store, ttl: 0 }),
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([{}, { store: undefined }, { store: 'memory' }] satisfies CacheModuleOptions[])(
    'keeps the memory store and TTL defaults for %j',
    (options) => {
      const providers = getModuleMetadata(CacheModule.forRoot(options))?.providers ?? [];

      expect(providers).toContainEqual({
        provide: CACHE_OPTIONS,
        useValue: expect.objectContaining({ store: 'memory', ttl: 300 }),
      });
    },
  );

  it.each(['full', 'route+queries'])(
    'rejects unsupported HTTP key strategy %j during registration',
    (httpKeyStrategy) => {
      const options: CacheModuleOptions = {};
      Object.defineProperty(options, 'httpKeyStrategy', {
        enumerable: true,
        value: httpKeyStrategy,
      });

      expect(() => CacheModule.forRoot(options)).toThrow(
        'httpKeyStrategy must be "route", "route+query", or a function.',
      );
    },
  );

  it('reads stateful TTL jitter options once and provides their normalized snapshot', () => {
    let modeReads = 0;
    let randomReads = 0;
    let ratioReads = 0;
    const random = (): number => 0.5;
    const ttlJitter = {
      get mode(): 'shorten' {
        modeReads += 1;

        if (modeReads > 1) {
          throw new Error('ttlJitter.mode must only be read once.');
        }

        return 'shorten';
      },
      get random(): () => number {
        randomReads += 1;

        if (randomReads > 1) {
          throw new Error('ttlJitter.random must only be read once.');
        }

        return random;
      },
      get ratio(): number {
        ratioReads += 1;

        if (ratioReads > 1) {
          throw new Error('ttlJitter.ratio must only be read once.');
        }

        return 0.25;
      },
    };

    const providers = getModuleMetadata(
      CacheModule.forRoot({ store: 'memory', ttlJitter }),
    )?.providers ?? [];
    const optionsProvider = providers.find(
      (provider: unknown): provider is {
        readonly provide: typeof CACHE_OPTIONS;
        readonly useValue: NormalizedCacheModuleOptions;
      } =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === CACHE_OPTIONS,
    );

    expect(modeReads).toBe(1);
    expect(randomReads).toBe(1);
    expect(ratioReads).toBe(1);
    expect(optionsProvider).toMatchObject({
      useValue: {
        global: false,
        httpKeyStrategy: 'route+query',
        keyPrefix: 'fluo:cache:',
        store: 'memory',
        ttl: 300,
        ttlJitter: {
          mode: 'shorten',
          random,
          ratio: 0.25,
        },
      },
    });
  });
});
