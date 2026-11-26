import { describe, expect, it, vi } from 'vitest';

import type { RemoteI18nCatalogProvider } from './remote.js';
import { CachedRemoteI18nLoader, RemoteI18nLoader } from './remote.js';

describe('CachedRemoteI18nLoader expiration', () => {
  it('releases an untouched expired catalog on a sweep triggered by a valid cache hit', async () => {
    let now = 0;
    const provider = vi.fn<RemoteI18nCatalogProvider>(({ namespace }) => ({ title: namespace }));
    const loader = RemoteI18nLoader.create({ provider });
    const cached = CachedRemoteI18nLoader.create({ loader, now: () => now, ttlMs: 10 });
    const winter = await cached.load('en', 'winter');
    now = 5;
    const spring = await cached.load('ko', 'spring');

    // Check the stored references directly: cache misses alone do not prove release.
    const storedCatalogs = () => Array.from(cached['cache'].values(), (entry) => entry.catalog);
    expect(storedCatalogs().some((catalog) => catalog === winter)).toBe(true);

    now = 10;
    const hit = await cached.load('ko', 'spring');

    expect(storedCatalogs().some((catalog) => catalog === winter)).toBe(false);
    expect(storedCatalogs()).toHaveLength(1);
    expect(storedCatalogs()[0]).toBe(spring);
    expect(hit).toBe(spring);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it.each(['reload', 'invalidate', 'clear'] as const)(
    'keeps a replacement under an aliased custom key through a sweep after %s',
    async (replacement) => {
      let now = 0;
      const provider = vi.fn<RemoteI18nCatalogProvider>(({ locale, namespace }) => ({ title: `${locale}/${namespace}` }));
      const loader = RemoteI18nLoader.create({ provider });
      const cached = CachedRemoteI18nLoader.create({
        loader,
        now: () => now,
        ttlMs: 10,
        getCacheKey: ({ namespace }) => (namespace === 'tick' ? 'tick' : 'shared'),
      });
      const other = CachedRemoteI18nLoader.create({ loader, now: () => now, ttlMs: 10 });
      await cached.load('en', 'tick');
      now = 1;
      const original = await cached.load('en', 'common');
      expect(await cached.load('ko', 'shared')).toBe(original);
      now = 10;
      const tick = await cached.load('en', 'tick');
      const otherCatalog = await other.load('en', 'tick');

      // Invalidate/clear before the original expires, and reload at its TTL boundary otherwise.
      if (replacement === 'invalidate') {
        cached.invalidate('ko', 'shared');
        expect(cached['cache'].has('shared')).toBe(false);
        expect(cached['cache'].get('tick')?.catalog).toBe(tick);
      } else if (replacement === 'clear') {
        cached.clear();
        expect(cached['cache'].size).toBe(0);
        expect(await other.load('en', 'tick')).toBe(otherCatalog);
      } else {
        now = 11;
      }
      // Completion at 12 means the replacement is valid through the next sweep at 20.
      const pending = cached.load('ko', 'shared');
      now = 12;
      const fresh = await pending;
      expect(fresh).not.toBe(original);

      now = 20;
      await cached.load('en', 'tick');

      expect(cached['cache'].get('shared')?.catalog).toBe(fresh);
      const callsAtSweep = provider.mock.calls.length;
      expect(await cached.load('en', 'common')).toBe(fresh);
      expect(provider).toHaveBeenCalledTimes(callsAtSweep);
    },
  );
});
