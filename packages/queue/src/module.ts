import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { normalizePositiveInteger, normalizeRateLimiter } from './helpers.js';
import { QueueLifecycleService } from './service.js';
import { QUEUE, QUEUE_OPTIONS } from './tokens.js';
import type { NormalizedQueueModuleOptions, QueueModuleOptions } from './types.js';

function normalizeQueueModuleOptions(options: QueueModuleOptions = {}): NormalizedQueueModuleOptions {
  const defaultRateLimiter = normalizeRateLimiter(options.defaultRateLimiter);

  return {
    defaultAttempts: normalizePositiveInteger(options.defaultAttempts, 1),
    defaultBackoff: options.defaultBackoff
      ? {
          delayMs: options.defaultBackoff.delayMs,
          type: options.defaultBackoff.type,
        }
      : undefined,
    defaultConcurrency: normalizePositiveInteger(options.defaultConcurrency, 1),
    defaultRateLimiter,
  };
}

/**
 * Creates queue lifecycle providers and normalized queue options.
 *
 * @param options Queue module defaults for attempts, backoff, concurrency, and rate limiting.
 * @returns Provider definitions that register normalized `QUEUE_OPTIONS`, `QueueLifecycleService`, and the compatibility alias `QUEUE`.
 */
export function createQueueProviders(options: QueueModuleOptions = {}): Provider[] {
  return [
    {
      provide: QUEUE_OPTIONS,
      useValue: normalizeQueueModuleOptions(options),
    },
    QueueLifecycleService,
    {
      inject: [QueueLifecycleService],
      provide: QUEUE,
      useFactory: (service: unknown) => ({
        enqueue: (job: object) => (service as QueueLifecycleService).enqueue(job),
      }),
    },
  ];
}

/**
 * Runtime module entrypoint for queue lifecycle wiring.
 */
export class QueueModule {
  /**
   * Registers queue providers globally using canonical `forRoot(...)` semantics.
   *
   * @param options Queue runtime defaults used by discovered workers and enqueued jobs.
   * @returns A module definition that exports `QueueLifecycleService` and the compatibility token `QUEUE`.
   *
   * @example
   * ```ts
   * import { Module } from '@konekti/core';
   * import { QueueModule } from '@konekti/queue';
   * import { RedisModule } from '@konekti/redis';
   *
   * @Module({
   *   imports: [
   *     RedisModule.forRoot({ host: 'localhost', port: 6379 }),
   *     QueueModule.forRoot({ defaultAttempts: 3 }),
   *   ],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: QueueModuleOptions = {}): ModuleType {
    class QueueModuleDefinition {}

    return defineModule(QueueModuleDefinition, {
      exports: [QueueLifecycleService, QUEUE],
      global: true,
      providers: createQueueProviders(options),
    });
  }
}
