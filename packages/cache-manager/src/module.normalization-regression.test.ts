import { getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { CacheModule } from './module.js';
import { CACHE_OPTIONS } from './tokens.js';
import type { NormalizedCacheModuleOptions } from './types.js';

describe('CacheModule.forRoot', () => {
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
        httpKeyStrategy: 'route',
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
