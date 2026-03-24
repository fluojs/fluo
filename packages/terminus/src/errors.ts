import type { HealthIndicatorResult } from './types.js';

export class HealthCheckError extends Error {
  readonly causes: HealthIndicatorResult;

  constructor(message: string, causes: HealthIndicatorResult) {
    super(message);
    this.name = 'HealthCheckError';
    this.causes = causes;
  }
}
