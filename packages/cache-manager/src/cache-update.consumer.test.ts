import { Inject } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CacheModule, CacheService } from './index.js';

describe('queue-free application cache updates', () => {
  it('increments through the registered public service and closes the application context', async () => {
    // Given: application code contains neither a pending map nor a per-key queue.
    @Inject(CacheService)
    class Counters {
      constructor(private readonly cache: CacheService) {}

      increment(key: string) {
        return this.cache.update<number>(key, (value) => ({
          action: 'set',
          value: (value ?? 0) + 1,
        }));
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      imports: [CacheModule.forRoot({ store: 'memory', ttl: 60 })],
      providers: [Counters],
    });
    const app = await FluoFactory.createApplicationContext(AppModule);

    try {
      const counters = await app.get(Counters);
      // When
      const values = await Promise.all(Array.from({ length: 20 }, () => counters.increment('article:views')));

      // Then: arithmetic is application policy; cache only owns atomicity and lifecycle.
      expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    } finally {
      await app.close();
    }
  });
});
