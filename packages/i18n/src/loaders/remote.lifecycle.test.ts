import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemoteI18nLoader } from './remote.js';

describe('RemoteI18nLoader abort listener lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('removes the provider-visible abort listener after a successful load', async () => {
    let observedSignal: AbortSignal | undefined;
    let resolveProvider: ((catalog: { readonly title: string }) => void) | undefined;
    const providerResult = new Promise<{ readonly title: string }>((resolve) => {
      resolveProvider = resolve;
    });
    const loader = new RemoteI18nLoader({
      provider: ({ signal }) => {
        observedSignal = signal;
        return providerResult;
      },
    });

    const addEventListener = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const load = loader.load('en', 'common');
    if (observedSignal === undefined || resolveProvider === undefined) {
      throw new Error('Expected the provider to start synchronously.');
    }
    const removeEventListener = vi.spyOn(observedSignal, 'removeEventListener');

    resolveProvider({ title: 'Welcome' });

    await expect(load).resolves.toEqual({ title: 'Welcome' });
    const registeredListener = addEventListener.mock.calls[0]?.[1];
    expect(registeredListener).toEqual(expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('abort', registeredListener);
  });

  it('removes the provider-visible abort listener after a failed load', async () => {
    let observedSignal: AbortSignal | undefined;
    let rejectProvider: ((error: Error) => void) | undefined;
    const providerResult = new Promise<never>((_resolve, reject) => {
      rejectProvider = reject;
    });
    const loader = new RemoteI18nLoader({
      provider: ({ signal }) => {
        observedSignal = signal;
        return providerResult;
      },
    });

    const addEventListener = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const load = loader.load('en', 'common');
    if (observedSignal === undefined || rejectProvider === undefined) {
      throw new Error('Expected the provider to start synchronously.');
    }
    const removeEventListener = vi.spyOn(observedSignal, 'removeEventListener');

    rejectProvider(new Error('network unavailable'));

    await expect(load).rejects.toMatchObject({ code: 'I18N_LOADER_FAILED' });
    const registeredListener = addEventListener.mock.calls[0]?.[1];
    expect(registeredListener).toEqual(expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('abort', registeredListener);
  });

  it('removes the provider-visible abort listener after a timeout abort', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const loader = new RemoteI18nLoader({
      provider: ({ signal }) => {
        observedSignal = signal;
        return new Promise<never>(() => undefined);
      },
      timeoutMs: 100,
    });

    const addEventListener = vi.spyOn(AbortSignal.prototype, 'addEventListener');

    try {
      const load = loader.load('en', 'common');
      if (observedSignal === undefined) {
        throw new Error('Expected the provider to start synchronously.');
      }
      const removeEventListener = vi.spyOn(observedSignal, 'removeEventListener');
      const rejection = expect(load).rejects.toMatchObject({ code: 'I18N_LOADER_TIMEOUT' });

      await vi.advanceTimersByTimeAsync(100);

      await rejection;
      const registeredListener = addEventListener.mock.calls[0]?.[1];
      expect(registeredListener).toEqual(expect.any(Function));
      expect(removeEventListener).toHaveBeenCalledWith('abort', registeredListener);
    } finally {
      vi.useRealTimers();
    }
  });
});
