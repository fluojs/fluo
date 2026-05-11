import { describe, expect, it } from 'vitest';

import { I18nError } from '../errors.js';
import type { I18nErrorCode, I18nMessageTree } from '../types.js';
import { RemoteI18nLoader, createRemoteI18nLoader } from './remote.js';

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
    const loader = new RemoteI18nLoader({
      provider: () => new Promise<unknown>(() => undefined),
      timeoutMs: 1,
    });

    await expectI18nRejection(() => loader.load('en', 'common'), 'I18N_LOADER_TIMEOUT');
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

    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    expect(remote.RemoteI18nLoader).toBe(RemoteI18nLoader);
    expect(remote.createRemoteI18nLoader).toBe(createRemoteI18nLoader);
  });
});
