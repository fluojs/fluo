import type { CacheObservation, CacheObserver } from './types.js';

interface MonotonicClock {
  now(): number;
}

function reportObservation(observer: CacheObserver, observation: CacheObservation): void {
  try {
    void Promise.resolve(observer.onCacheOperation(observation)).catch(() => undefined);
  } catch {
    return;
  }
}

/**
 * Internal operation wrapper that times cache work and contains observer failures.
 */
export class CacheOperationObserver {
  constructor(
    private readonly observer: CacheObserver | undefined,
    private readonly clock: MonotonicClock,
  ) {}

  async observeRead<T>(
    operation: 'get' | 'remember',
    run: () => Promise<T>,
    classify: (value: T) => 'hit' | 'miss',
  ): Promise<T> {
    if (!this.observer) {
      return run();
    }

    const startedAt = this.clock.now();

    try {
      const value = await run();
      reportObservation(this.observer, {
        durationMs: this.clock.now() - startedAt,
        operation,
        outcome: classify(value),
      });
      return value;
    } catch (error) {
      reportObservation(this.observer, {
        durationMs: this.clock.now() - startedAt,
        operation,
        outcome: 'error',
      });
      throw error;
    }
  }

  async observeWrite<T>(
    operation: 'set' | 'del' | 'reset' | 'close',
    run: () => Promise<T>,
  ): Promise<T> {
    if (!this.observer) {
      return run();
    }

    const startedAt = this.clock.now();

    try {
      const value = await run();
      reportObservation(this.observer, {
        durationMs: this.clock.now() - startedAt,
        operation,
        outcome: 'success',
      });
      return value;
    } catch (error) {
      reportObservation(this.observer, {
        durationMs: this.clock.now() - startedAt,
        operation,
        outcome: 'error',
      });
      throw error;
    }
  }
}
