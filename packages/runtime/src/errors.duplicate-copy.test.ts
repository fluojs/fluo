import { describe, expect, it, vi } from 'vitest';

import { PlatformLifecycleConflictError } from './errors.js';

describe('runtime lifecycle duplicate-copy contract', () => {
  it('recognizes a lifecycle conflict produced by a separate module copy', async () => {
    const duplicateCopyError = new PlatformLifecycleConflictError('start', 'stop');
    vi.resetModules();
    const { PlatformLifecycleConflictError: currentError, isPlatformLifecycleConflictError } = await import('./errors.js');

    expect(duplicateCopyError).not.toBeInstanceOf(currentError);
    expect(isPlatformLifecycleConflictError(duplicateCopyError)).toBe(true);
  });
});
