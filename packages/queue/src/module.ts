import type { Provider } from '@fluojs/di';
import type { Container } from '@fluojs/di';
import { getRedisClientToken } from '@fluojs/redis';
import { defineModule, type ApplicationLogger, type CompiledModule, type ModuleType } from '@fluojs/runtime';
import {
  APPLICATION_LOGGER,
  BOOTSTRAP_READY_SIGNAL,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
} from '@fluojs/runtime/internal';
import type { BootstrapReadySignal } from '@fluojs/runtime/internal';

import { normalizePositiveInteger, normalizePositiveIntegerOrFalse, normalizeRateLimiter } from './helpers.js';
import { QueueLifecycleService } from './service.js';
import { QUEUE, QUEUE_MODULE_CONTEXT, QUEUE_OPTIONS } from './tokens.js';
import type { QueueModuleContext } from './tokens.js';
import type { NormalizedQueueModuleOptions, QueueModuleOptions } from './types.js';

interface QueueModuleRedisClient {
  duplicate(options?: { maxRetriesPerRequest: null }): QueueModuleRedisConnection;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  rpush(key: string, value: string): Promise<unknown>;
}

interface QueueModuleRedisConnection {
  connect(): Promise<unknown>;
  disconnect(): void;
  quit(): Promise<unknown>;
  maxRetriesPerRequest?: number | null;
  status?: string;
}

type QueueLifecycleServiceFactoryDeps = [
  NormalizedQueueModuleOptions,
  QueueModuleRedisClient,
  Container,
  readonly CompiledModule[],
  ApplicationLogger,
  BootstrapReadySignal,
  QueueModuleContext,
];

function normalizeQueueModuleOptions(options: QueueModuleOptions = {}): NormalizedQueueModuleOptions {
  const defaultRateLimiter = normalizeRateLimiter(options.defaultRateLimiter);

  return {
    clientName: options.clientName,
    defaultAttempts: normalizePositiveInteger(options.defaultAttempts, 1),
    defaultBackoff: options.defaultBackoff
      ? {
          delayMs: options.defaultBackoff.delayMs,
          type: options.defaultBackoff.type,
        }
      : undefined,
    defaultConcurrency: normalizePositiveInteger(options.defaultConcurrency, 1),
    defaultDeadLetterMaxEntries: normalizePositiveIntegerOrFalse(options.defaultDeadLetterMaxEntries, 1_000),
    defaultRateLimiter,
    global: options.global ?? true,
    workerShutdownTimeoutMs: normalizePositiveInteger(options.workerShutdownTimeoutMs, 30_000),
  };
}

function createQueueProviders(options: QueueModuleOptions = {}, moduleType: ModuleType): Provider[] {
  const redisToken = getRedisClientToken(options.clientName);

  return [
    {
      provide: QUEUE_OPTIONS,
      useValue: normalizeQueueModuleOptions(options),
    },
    {
      provide: QUEUE_MODULE_CONTEXT,
      useValue: { moduleType } satisfies QueueModuleContext,
    },
    {
      inject: [
        QUEUE_OPTIONS,
        redisToken,
        RUNTIME_CONTAINER,
        COMPILED_MODULES,
        APPLICATION_LOGGER,
        BOOTSTRAP_READY_SIGNAL,
        QUEUE_MODULE_CONTEXT,
      ],
      provide: QueueLifecycleService,
      useFactory: (...deps: unknown[]) => {
        const typedDeps = deps as QueueLifecycleServiceFactoryDeps;

        return new QueueLifecycleService(...typedDeps);
      },
    },
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
   * import { Module } from '@fluojs/core';
   * import { QueueModule } from '@fluojs/queue';
   * import { RedisModule } from '@fluojs/redis';
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
      global: options.global ?? true,
      providers: createQueueProviders(options, QueueModuleDefinition),
    });
  }
}
