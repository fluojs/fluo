import { describe, expect, it, vi } from 'vitest';

import { I18nError } from '../errors.js';
import type { I18nErrorCode, I18nMessageTree } from '../types.js';
import type { I18nLoader, I18nLoaderLoadOptions } from './remote.js';
import { CachedRemoteI18nLoader, createCachedRemoteI18nLoader, createRemoteI18nLoader, RemoteI18nLoader } from './remote.js';

async function expectI18nRejection(action: () => Promise<unknown>, code: I18nErrorCode): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

function expectI18nThrow(action: () => unknown, code: I18nErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe(code);
    return;
  }

  throw new Error(`Expected action to fail with ${code}.`);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('@fluojs/i18n/loaders/remote', () => {
  it('loads and freezes remote object catalogs from locale and namespace requests', async () => {
    const providerCatalog = { save: 'Save', nested: { cancel: 'Cancel' } };
    const loader = createRemoteI18nLoader({
      provider: ({ locale, namespace, signal }) => {
        expect(locale).toBe('en');
        expect(namespace).toBe('common/actions');
        expect(signal.aborted).toBe(false);
        return providerCatalog;
      },
    });

    const catalog = await loader.load('en', 'common/actions');

    providerCatalog.nested.cancel = 'Changed';
    expect(catalog).toEqual({ save: 'Save', nested: { cancel: 'Cancel' } });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.nested)).toBe(true);
  });

  it('loads remote JSON string catalogs into immutable message trees', async () => {
    const loader = new RemoteI18nLoader({
      provider: () => JSON.stringify({ title: 'Welcome' }),
    });

    const catalog = await loader.load('en', 'common');

    expect(catalog).toEqual({ title: 'Welcome' });
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it('does not cache catalogs and delegates caching policy to the provider', async () => {
    let providerCalls = 0;
    const loader = new RemoteI18nLoader({
      provider: () => {
        providerCalls += 1;
        return { title: `Welcome ${providerCalls}` };
      },
    });

    await expect(loader.load('en', 'common')).resolves.toEqual({ title: 'Welcome 1' });
    await expect(loader.load('en', 'common')).resolves.toEqual({ title: 'Welcome 2' });
    expect(providerCalls).toBe(2);
  });

  it('caches remote catalogs only through the explicit cache wrapper', async () => {
    let providerCalls = 0;
    let now = 1_000;
    const loader = new RemoteI18nLoader({
      provider: () => {
        providerCalls += 1;
        return { title: `Welcome ${providerCalls}` };
      },
    });
    const cached = createCachedRemoteI18nLoader({ loader, now: () => now, ttlMs: 100, version: 'v1' });

    await expect(cached.load('en', 'common')).resolves.toEqual({ title: 'Welcome 1' });
    await expect(cached.load('en', 'common')).resolves.toEqual({ title: 'Welcome 1' });
    now = 1_101;
    await expect(cached.load('en', 'common')).resolves.toEqual({ title: 'Welcome 2' });
    expect(providerCalls).toBe(2);
  });

  it('separates default cache entries by caller-owned catalog version', async () => {
    let providerCalls = 0;
    const loader = new RemoteI18nLoader({
      provider: () => {
        providerCalls += 1;
        return { title: `Welcome ${providerCalls}` };
      },
    });
    const stableCatalog = createCachedRemoteI18nLoader({ loader, ttlMs: 1_000, version: 'stable' });
    const canaryCatalog = createCachedRemoteI18nLoader({ loader, ttlMs: 1_000, version: 'canary' });

    await expect(stableCatalog.load('en', 'common')).resolves.toEqual({ title: 'Welcome 1' });
    await expect(stableCatalog.load('en', 'common')).resolves.toEqual({ title: 'Welcome 1' });
    await expect(canaryCatalog.load('en', 'common')).resolves.toEqual({ title: 'Welcome 2' });
    await expect(canaryCatalog.load('en', 'common')).resolves.toEqual({ title: 'Welcome 2' });
    expect(providerCalls).toBe(2);
  });

  it('supports caller-owned cache keys and explicit invalidation', async () => {
    let providerCalls = 0;
    const loader = new RemoteI18nLoader({
      provider: ({ locale, namespace }) => {
        providerCalls += 1;
        return { title: `${locale}/${namespace}/${providerCalls}` };
      },
    });
    const cached = new CachedRemoteI18nLoader({
      getCacheKey: ({ locale, namespace, version }) => `${version}:${locale}:${namespace}`,
      loader,
      ttlMs: 1_000,
      version: 'catalog-2026-05-11',
    });

    await expect(cached.load('ko', 'common')).resolves.toEqual({ title: 'ko/common/1' });
    await expect(cached.load('ko', 'common')).resolves.toEqual({ title: 'ko/common/1' });
    cached.invalidate('ko', 'common');
    await expect(cached.load('ko', 'common')).resolves.toEqual({ title: 'ko/common/2' });
    cached.clear();
    await expect(cached.load('ko', 'common')).resolves.toEqual({ title: 'ko/common/3' });
    expect(providerCalls).toBe(3);
  });

  it('fails with a stable code for missing remote catalogs', async () => {
    const undefinedLoader = new RemoteI18nLoader({ provider: () => undefined });
    const nullLoader = new RemoteI18nLoader({ provider: () => null });

    await expectI18nRejection(() => undefinedLoader.load('en', 'missing'), 'I18N_MISSING_CATALOG');
    await expectI18nRejection(() => nullLoader.load('en', 'missing'), 'I18N_MISSING_CATALOG');
  });

  it('fails with a stable code for malformed JSON and invalid message tree shapes', async () => {
    const malformedLoader = new RemoteI18nLoader({ provider: () => '{' });
    const arrayLoader = new RemoteI18nLoader({ provider: () => ['not', 'a', 'tree'] });
    const invalidEntryLoader = new RemoteI18nLoader({ provider: () => ({ enabled: true }) });
    const emptyKeyLoader = new RemoteI18nLoader({ provider: () => ({ '': 'blank' }) });

    await expectI18nRejection(() => malformedLoader.load('en', 'common'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => arrayLoader.load('en', 'common'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => invalidEntryLoader.load('en', 'common'), 'I18N_INVALID_CATALOG');
    await expectI18nRejection(() => emptyKeyLoader.load('en', 'common'), 'I18N_INVALID_CATALOG');
  });

  it('wraps provider failures with a stable loader failure code', async () => {
    const loader = new RemoteI18nLoader({
      provider: () => {
        throw new Error('network unavailable');
      },
    });

    await expectI18nRejection(() => loader.load('en', 'common'), 'I18N_LOADER_FAILED');
  });

  it('preserves provider-thrown i18n errors without remapping', async () => {
    const loader = new RemoteI18nLoader({
      provider: () => {
        throw new I18nError('backend reported a missing catalog', 'I18N_MISSING_CATALOG');
      },
    });

    await expectI18nRejection(() => loader.load('en', 'common'), 'I18N_MISSING_CATALOG');
  });

  it('aborts provider work and rejects with a stable timeout code', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const loader = new RemoteI18nLoader({
      provider: async ({ signal }) => {
        observedSignal = signal;
        await waitForAbort(signal);
        return { title: 'timed out' };
      },
      timeoutMs: 100,
    });

    try {
      const load = loader.load('en', 'common');
      const rejection = expectI18nRejection(() => load, 'I18N_LOADER_TIMEOUT');
      await vi.advanceTimersByTimeAsync(100);

      await rejection;
      if (observedSignal === undefined) {
        throw new Error('Expected the provider to receive the loader signal.');
      }
      expect(observedSignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects already-aborted caller signals before provider invocation', async () => {
    const controller = new AbortController();
    let providerCalls = 0;
    const loader = new RemoteI18nLoader({
      provider: () => {
        providerCalls += 1;
        return { title: 'unused' };
      },
    });

    controller.abort();

    await expectI18nRejection(() => loader.load('en', 'common', { signal: controller.signal }), 'I18N_LOADER_ABORTED');
    expect(providerCalls).toBe(0);
  });

  it('propagates caller cancellation to the remote provider', async () => {
    const controller = new AbortController();
    const loader = new RemoteI18nLoader({
      provider: ({ signal }) => waitForAbort(signal).then(() => ({ title: 'cancelled' })),
    });

    const load = loader.load('en', 'common', { signal: controller.signal });
    controller.abort();

    await expectI18nRejection(() => load, 'I18N_LOADER_ABORTED');
  });

  it('rejects invalid constructor, locale, and namespace options before provider calls', async () => {
    let providerCalls = 0;
    const loader = new RemoteI18nLoader({
      provider: (): I18nMessageTree => {
        providerCalls += 1;
        return { title: 'unused' };
      },
    });

    expectI18nThrow(() => new RemoteI18nLoader({ provider: undefined } as unknown as { readonly provider: () => unknown }), 'I18N_INVALID_LOADER_OPTIONS');
    expectI18nThrow(() => new RemoteI18nLoader({ provider: () => ({}), timeoutMs: 0 }), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('../en', 'common'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', 'common.json'), 'I18N_INVALID_LOADER_OPTIONS');
    await expectI18nRejection(() => loader.load('en', '../secrets'), 'I18N_INVALID_LOADER_OPTIONS');
    expect(providerCalls).toBe(0);
  });

  it('is available from the remote loader subpath without adding root value exports', async () => {
    const root = await import('../index.js');
    const remote = await import('./remote.js');
    const loaderLoadOptions: I18nLoaderLoadOptions = {};
    const loader: I18nLoader = new RemoteI18nLoader({ provider: () => ({ title: 'typed' }) });

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    expect(remote.RemoteI18nLoader).toBe(RemoteI18nLoader);
    expect(remote.CachedRemoteI18nLoader).toBe(CachedRemoteI18nLoader);
    expect(remote.createCachedRemoteI18nLoader).toBe(createCachedRemoteI18nLoader);
    expect(remote.createRemoteI18nLoader).toBe(createRemoteI18nLoader);
    await expect(loader.load('en', 'common', loaderLoadOptions)).resolves.toEqual({ title: 'typed' });
  });
});
