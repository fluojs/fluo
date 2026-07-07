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
import { QUEUE, QUEUE_MODULE_CONTEXT, QUEUE_OPTIONS, QUEUE_REDIS_CLIENT } from './tokens.js';
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

function hasQueueRedisClient(value: unknown): value is QueueModuleRedisClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { duplicate?: unknown; ltrim?: unknown; rpush?: unknown };

  return typeof client.duplicate === 'function' && typeof client.rpush === 'function' && typeof client.ltrim === 'function';
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
      inject: [QUEUE_OPTIONS, RUNTIME_CONTAINER],
      provide: QUEUE_REDIS_CLIENT,
      useFactory: async (...deps: unknown[]) => {
        const [normalizedOptions, runtimeContainer] = deps as [NormalizedQueueModuleOptions, Container];
        const redisToken = getRedisClientToken(normalizedOptions.clientName);

        if (!runtimeContainer.has(redisToken)) {
          throw new Error('@fluojs/queue requires a registered Redis client with duplicate(), rpush(), and ltrim() methods.');
        }

        const redisClient = await runtimeContainer.resolve(redisToken);

        if (!hasQueueRedisClient(redisClient)) {
          throw new Error('@fluojs/queue requires a Redis client with duplicate(), rpush(), and ltrim() methods.');
        }

        return redisClient;
      },
    },
    {
      inject: [
        QUEUE_OPTIONS,
        QUEUE_REDIS_CLIENT,
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
