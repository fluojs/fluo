import { describe, expect, it, vi } from 'vitest';

import { createAbortError, raceWithAbort } from './abort.js';

describe('raceWithAbort', () => {
  it('resolves with the fn result when the signal never aborts', async () => {
    const controller = new AbortController();
    await expect(raceWithAbort(async () => 'ok', controller.signal)).resolves.toBe('ok');
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceWithAbort(async () => 'ok', controller.signal)).rejects.toSatisfy((error) => {
      return error instanceof Error && error.name === 'AbortError';
    });
  });

  it('rejects with an AbortError when the signal aborts while fn is pending', async () => {
    const controller = new AbortController();
    let resolveFn: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveFn = resolve;
    });
    const promise = raceWithAbort(() => pending, controller.signal);
    controller.abort();
    await expect(promise).rejects.toSatisfy((error) => {
      return error instanceof Error && error.name === 'AbortError';
    });
    resolveFn!('ok');
  });

  it('rethrows the original error when fn throws synchronously', async () => {
    const controller = new AbortController();
    const boom = new Error('sync throw');
    await expect(
      raceWithAbort(() => {
        throw boom;
      }, controller.signal),
    ).rejects.toBe(boom);
  });

  it('removes the abort listener after fn throws synchronously', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const boom = new Error('sync throw');
    await expect(
      raceWithAbort(() => {
        throw boom;
      }, controller.signal),
    ).rejects.toBe(boom);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not fire the abort listener after fn throws synchronously', async () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    controller.signal.addEventListener('abort', onAbort);
    const boom = new Error('sync throw');
    await expect(
      raceWithAbort(() => {
        throw boom;
      }, controller.signal),
    ).rejects.toBe(boom);
    controller.abort();
    // The raceWithAbort-owned listener is removed; only the test-owned
    // listener remains and fires once.
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('removes the abort listener after fn resolves', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    await raceWithAbort(async () => 'ok', controller.signal);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('createAbortError', () => {
  it('normalizes an Error reason into an AbortError preserving the message', () => {
    const error = createAbortError(new Error('boom'));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('boom');
  });

  it('uses a default message for non-Error reasons', () => {
    const error = createAbortError('something else');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('Request aborted before response commit.');
  });
});