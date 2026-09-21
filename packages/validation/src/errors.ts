import { isFluoError, setFluoErrorContract } from '@fluojs/core';

import type { ValidationIssue } from './types.js';

/**
 * Represents the dto validation error.
 */
export class DtoValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'DtoValidationError';
    Object.defineProperty(this, 'code', { value: 'DTO_VALIDATION_ERROR' });
    setFluoErrorContract(this, '@fluojs/validation');
  }
}

/**
 * Recognizes compatible validation errors across duplicate package copies.
 * @param value Candidate thrown value.
 * @returns Whether the value satisfies the DTO validation error contract.
 */
export function isDtoValidationError(value: unknown): value is DtoValidationError {
  if (!isFluoError(value, '@fluojs/validation')) return false;
  const issues = (value as unknown as DtoValidationError).issues;
  return Array.isArray(issues) && issues.every((issue) => {
    if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return false;
    const record = issue as unknown as Record<string, unknown>;
    return typeof record.message === 'string' && typeof record.code === 'string';
  });
}
