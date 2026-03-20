import { describe, expect, it } from 'vitest';

import { toInputErrorDetail } from './input-error-detail.js';

describe('input error detail mapping', () => {
  it('maps input issue shape to HTTP exception detail contract', () => {
    const detail = toInputErrorDetail({
      code: 'MISSING_FIELD',
      field: 'name',
      message: 'name is required',
      source: 'body',
    });

    expect(detail).toEqual({
      code: 'MISSING_FIELD',
      field: 'name',
      message: 'name is required',
      source: 'body',
    });
  });
});
