import { describe, expect, it, vi } from 'vitest';

import { DtoValidationError, isDtoValidationError } from './errors.js';

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

  it.each([null, 123, false, {}, []].map((field) => ({ field })))(
    'isDtoValidationError rejects a non-string field $field with a valid source',
    ({ field }) => {
      const error = Reflect.construct(DtoValidationError, ['Invalid input.', [
        { code: 'INVALID_NAME', message: 'Name is invalid.', field, source: 'body' },
      ]]);

      expect(isDtoValidationError(error)).toBe(false);
    },
  );

  it.each(['invalid-source', '', null, 123, false, {}, []].map((source) => ({ source })))(
    'isDtoValidationError rejects an unsupported source $source with a valid field',
    ({ source }) => {
      const error = Reflect.construct(DtoValidationError, ['Invalid input.', [
        { code: 'INVALID_NAME', message: 'Name is invalid.', field: 'name', source },
      ]]);

      expect(isDtoValidationError(error)).toBe(false);
    },
  );

  it.each([
    {},
    { field: undefined, source: undefined },
    { field: '' },
    { field: 'name' },
    { field: 'address.city' },
    { field: 'items[0].name' },
    ...['path', 'query', 'header', 'cookie', 'body', 'files'].map((source) => ({
      field: 'name',
      source,
    })),
  ])('isDtoValidationError accepts valid optional issue fields %j unchanged', (optionalFields) => {
    const issue = { code: '', message: '', ...optionalFields };
    const issues = [issue];
    const error = Reflect.construct(DtoValidationError, ['Invalid input.', issues]);

    expect(isDtoValidationError(error)).toBe(true);
    expect(error.issues).toBe(issues);
    expect(error.issues[0]).toBe(issue);
  });

  it.each([
    undefined, null, {}, 'issues',
    [null], [123], ['issue'], [[]],
    [{}], [{ code: 'INVALID_NAME' }], [{ message: 'Name is invalid.' }],
    [{ code: 123, message: 'Name is invalid.' }],
    [{ code: 'INVALID_NAME', message: 123 }],
    [
      { code: 'VALID', message: 'Valid.' },
      { code: 'INVALID', message: 'Invalid.', field: null },
    ],
    [
      { code: 'VALID', message: 'Valid.' },
      { code: 'INVALID', message: 'Invalid.', source: null },
    ],
  ].map((issues) => ({ issues })))('isDtoValidationError rejects malformed issues $issues', ({ issues }) => {
    const error = Reflect.construct(DtoValidationError, ['Invalid input.', issues]);

    expect(isDtoValidationError(error)).toBe(false);
  });

  it('isDtoValidationError accepts an empty issues array', () => {
    const error = new DtoValidationError('Invalid input.', []);

    expect(isDtoValidationError(error)).toBe(true);
  });

  it('isDtoValidationError rejects an unbranded error with valid issues', () => {
    const error = Object.assign(new Error('Invalid input.'), {
      code: 'DTO_VALIDATION_ERROR',
      issues: [{ code: 'INVALID_NAME', message: 'Name is invalid.' }],
    });

    expect(isDtoValidationError(error)).toBe(false);
  });

  it.each([
    { owner: '@fluojs/core', version: 1 },
    { owner: '@fluojs/validation', version: 2 },
  ])('isDtoValidationError rejects an incompatible contract %j', (contract) => {
    const error = new DtoValidationError('Invalid input.', []);
    Object.defineProperty(error, Symbol.for('fluo.error.contract'), { value: contract });

    expect(isDtoValidationError(error)).toBe(false);
  });
});
