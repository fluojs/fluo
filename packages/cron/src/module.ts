import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { CronLifecycleService } from './service.js';
import { defaultCronScheduler } from './scheduler.js';
import { CRON_OPTIONS, SCHEDULING_REGISTRY } from './tokens.js';
import type { CronModuleOptions, NormalizedCronModuleOptions } from './types.js';

const DEFAULT_CRON_SHUTDOWN_TIMEOUT_MS = 10_000;

function randomId(): string {
  return `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDistributedOptions(distributed: CronModuleOptions['distributed']): NormalizedCronModuleOptions['distributed'] {
  if (distributed === undefined || distributed === false) {
    return {
      clientName: undefined,
      enabled: false,
      keyPrefix: 'fluo:cron:lock',
      lockTtlMs: 30_000,
      ownerId: randomId(),
    };
  }

  if (distributed === true) {
    return {
      clientName: undefined,
      enabled: true,
      keyPrefix: 'fluo:cron:lock',
      lockTtlMs: 30_000,
      ownerId: randomId(),
    };
  }

  return {
    clientName: distributed.clientName,
    enabled: distributed.enabled ?? true,
    keyPrefix: distributed.keyPrefix ?? 'fluo:cron:lock',
    lockTtlMs: distributed.lockTtlMs ?? 30_000,
    ownerId: distributed.ownerId ?? randomId(),
  };
}

function normalizeShutdownOptions(shutdown: CronModuleOptions['shutdown']): NormalizedCronModuleOptions['shutdown'] {
  const timeoutMs = shutdown?.timeoutMs ?? DEFAULT_CRON_SHUTDOWN_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
    throw new Error('Cron shutdown timeoutMs must be a non-negative integer.');
  }

  return {
    timeoutMs,
  };
}

/**
 * Normalizes module options so the runtime can rely on concrete scheduler and lock settings.
 *
 * @param options Raw cron module options supplied by the application.
 * @returns A normalized options object with concrete distributed defaults and scheduler implementation.
 */
export function normalizeCronModuleOptions(options: CronModuleOptions = {}): NormalizedCronModuleOptions {
  return {
    distributed: normalizeDistributedOptions(options.distributed),
    scheduler: options.scheduler ?? defaultCronScheduler,
    shutdown: normalizeShutdownOptions(options.shutdown),
  };
}

/**
 * Creates the providers required for scheduler lifecycle management.
 *
 * @param options Raw cron module options used to configure the scheduling registry.
 * @returns Providers for normalized options and the shared scheduling registry token.
 */
export function createCronProviders(options: CronModuleOptions = {}): Provider[] {
  return [
    {
      provide: CRON_OPTIONS,
      useValue: normalizeCronModuleOptions(options),
    },
    {
      provide: SCHEDULING_REGISTRY,
      useClass: CronLifecycleService,
    },
  ];
}

/** Runtime module entrypoint for decorator-driven scheduling. */
export class CronModule {
  /**
   * Registers the scheduling registry and optional distributed locking defaults.
   *
   * @param options Scheduler and distributed-lock options for discovered and dynamic tasks.
   * @returns A module definition that exports the {@link SCHEDULING_REGISTRY} token.
   *
   * @example
   * ```ts
   * import { Module } from '@fluojs/core';
   * import { CronModule } from '@fluojs/cron';
   *
   * @Module({
   *   imports: [CronModule.forRoot({ distributed: true })],
   * })
   * export class AppModule {}
   * ```
   */
  static forRoot(options: CronModuleOptions = {}): ModuleType {
    class CronModuleDefinition {}

    return defineModule(CronModuleDefinition, {
      exports: [SCHEDULING_REGISTRY],
      providers: createCronProviders(options),
    });
  }
}
