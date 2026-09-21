import { describe, expect, it, vi } from 'vitest';

import { DtoValidationError } from './errors.js';

describe('DTO validation duplicate-copy contract', () => {
  it('recognizes a DtoValidationError produced by a separate module copy', async () => {
    const duplicateCopyError = new DtoValidationError('Invalid input.', [
      { code: 'INVALID_NAME', field: 'name', message: 'Name is invalid.' },
    ]);
    vi.resetModules();
    const { DtoValidationError: currentError, isDtoValidationError } = await import('./errors.js');

    expect(duplicateCopyError).not.toBeInstanceOf(currentError);
    expect(isDtoValidationError(duplicateCopyError)).toBe(true);
  });
});
