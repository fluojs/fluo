import { describe, expect, it, vi } from 'vitest';

import { I18nError } from './errors.js';

describe('i18n duplicate-copy contract', () => {
  it('recognizes an I18nError produced by a separate module copy', async () => {
    const duplicateCopyError = new I18nError('Missing translation.', 'I18N_MISSING_MESSAGE');
    vi.resetModules();
    const { I18nError: currentError, isI18nError } = await import('./errors.js');

    expect(duplicateCopyError).not.toBeInstanceOf(currentError);
    expect(isI18nError(duplicateCopyError)).toBe(true);
  });
});
