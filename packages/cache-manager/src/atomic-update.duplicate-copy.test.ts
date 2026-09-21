import { describe, expect, it, vi } from 'vitest';

import { CacheUpdateError } from './atomic-update.js';

describe('cache update duplicate-copy contract', () => {
  it('preserves the cancellation reason from a separate module copy', async () => {
    const duplicateCopyError = new CacheUpdateError('invalidated');
    const controller = new AbortController();
    controller.abort(duplicateCopyError);
    vi.resetModules();
    const { CacheUpdateError: currentError, checkUpdateSignal } = await import('./atomic-update.js');

    expect(duplicateCopyError).not.toBeInstanceOf(currentError);
    expect(() => checkUpdateSignal(controller.signal)).toThrow(duplicateCopyError);
  });
});
