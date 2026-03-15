import type { ValidationIssue } from './types.js';

export class DtoValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(message);
    this.name = 'DtoValidationError';
  }
}
