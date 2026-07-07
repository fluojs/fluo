import type { Token } from '@fluojs/core';
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
import {
  getQueueLifecycleServiceToken,
  getQueueModuleContextToken,
  getQueueOptionsToken,
  getQueueRedisClientToken as getQueueScopedRedisClientToken,
  getQueueToken,
  normalizeQueueScope,
  QUEUE,
} from './tokens.js';
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

interface QueueProviderTokens {
  readonly lifecycleServiceToken: Token;
  readonly moduleContextToken: Token;
  readonly optionsToken: Token;
  readonly queueRedisClientToken: Token;
  readonly queueToken: Token;
}

function normalizeQueueModuleOptions(options: QueueModuleOptions = {}): NormalizedQueueModuleOptions {
  const defaultRateLimiter = normalizeRateLimiter(options.defaultRateLimiter);
  const scope = normalizeQueueScope(options.scope);

  return {
    clientName: options.clientName,
    ...(scope ? { scope } : {}),
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

function getQueueProviderTokens(scope?: string): QueueProviderTokens {
  return {
    lifecycleServiceToken: getQueueLifecycleServiceToken(scope),
    moduleContextToken: getQueueModuleContextToken(scope),
    optionsToken: getQueueOptionsToken(scope),
    queueRedisClientToken: getQueueScopedRedisClientToken(scope),
    queueToken: getQueueToken(scope),
  };
}

function moduleCanAccessQueueRegistration(compiledModule: CompiledModule, moduleType: ModuleType): boolean {
  return compiledModule.type === moduleType || (compiledModule.definition.imports ?? []).includes(moduleType);
}

function canAccessRedisClient(
  compiledModules: readonly CompiledModule[],
  moduleContext: QueueModuleContext,
  redisToken: Token,
): boolean {
  return compiledModules.some(
    (compiledModule) =>
      moduleCanAccessQueueRegistration(compiledModule, moduleContext.moduleType) && compiledModule.accessibleTokens.has(redisToken),
  );
}

function formatQueueScope(scope: string | undefined): string {
  return scope ?? 'default';
}

function createQueueProviders(normalizedOptions: NormalizedQueueModuleOptions, moduleType: ModuleType): Provider[] {
  const tokens = getQueueProviderTokens(normalizedOptions.scope);
  const providers: Provider[] = [
    {
      provide: tokens.optionsToken,
      useValue: normalizedOptions,
    },
    {
      provide: tokens.moduleContextToken,
      useValue: { moduleType, scope: formatQueueScope(normalizedOptions.scope) } satisfies QueueModuleContext,
    },
    {
      inject: [tokens.optionsToken, RUNTIME_CONTAINER, COMPILED_MODULES, tokens.moduleContextToken],
      provide: tokens.queueRedisClientToken,
      useFactory: async (...deps: unknown[]) => {
        const [resolvedOptions, runtimeContainer, compiledModules, moduleContext] = deps as [
          NormalizedQueueModuleOptions,
          Container,
          readonly CompiledModule[],
          QueueModuleContext,
        ];
        const redisToken = getRedisClientToken(resolvedOptions.clientName);

        if (!canAccessRedisClient(compiledModules, moduleContext, redisToken)) {
          throw new Error(
            `@fluojs/queue cannot access Redis client token ${String(redisToken)} from queue scope "${moduleContext.scope}". Import and export the matching RedisModule.forRoot(...) registration through the same module graph.`,
          );
        }

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
        tokens.optionsToken,
        tokens.queueRedisClientToken,
        RUNTIME_CONTAINER,
        COMPILED_MODULES,
        APPLICATION_LOGGER,
        BOOTSTRAP_READY_SIGNAL,
        tokens.moduleContextToken,
      ],
      provide: tokens.lifecycleServiceToken,
      useFactory: (...deps: unknown[]) => {
        const typedDeps = deps as QueueLifecycleServiceFactoryDeps;

        return new QueueLifecycleService(...typedDeps);
      },
    },
    {
      inject: [tokens.lifecycleServiceToken],
      provide: tokens.queueToken,
      useFactory: (service: unknown) => ({
        enqueue: (job: object) => (service as QueueLifecycleService).enqueue(job),
      }),
    },
  ];

  if (normalizedOptions.scope === undefined) {
    providers.push({
      provide: QueueLifecycleService,
      useExisting: tokens.lifecycleServiceToken,
    });
  }

  return providers;
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
    const normalizedOptions = normalizeQueueModuleOptions(options);
    const tokens = getQueueProviderTokens(normalizedOptions.scope);
    class QueueModuleDefinition {}

    return defineModule(QueueModuleDefinition, {
      exports: normalizedOptions.scope === undefined
        ? [QueueLifecycleService, QUEUE]
        : [tokens.lifecycleServiceToken, tokens.queueToken],
      global: normalizedOptions.global,
      providers: createQueueProviders(normalizedOptions, QueueModuleDefinition),
    });
  }
}
