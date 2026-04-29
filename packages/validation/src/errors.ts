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
  }
}
