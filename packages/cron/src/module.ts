import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { CronLifecycleService } from './service.js';
import { defaultCronScheduler } from './scheduler.js';
import { CRON_OPTIONS, SCHEDULING_REGISTRY } from './tokens.js';
import type { CronDistributedOptions, CronModuleOptions, NormalizedCronModuleOptions } from './types.js';

function randomId(): string {
  return `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDistributedOptions(distributed: CronModuleOptions['distributed']): Required<CronDistributedOptions> & { enabled: boolean } {
  if (distributed === undefined || distributed === false) {
    return {
      enabled: false,
      keyPrefix: 'konekti:cron:lock',
      lockTtlMs: 30_000,
      ownerId: randomId(),
    };
  }

  if (distributed === true) {
    return {
      enabled: true,
      keyPrefix: 'konekti:cron:lock',
      lockTtlMs: 30_000,
      ownerId: randomId(),
    };
  }

  return {
    enabled: distributed.enabled ?? true,
    keyPrefix: distributed.keyPrefix ?? 'konekti:cron:lock',
    lockTtlMs: distributed.lockTtlMs ?? 30_000,
    ownerId: distributed.ownerId ?? randomId(),
  };
}

export function normalizeCronModuleOptions(options: CronModuleOptions = {}): NormalizedCronModuleOptions {
  return {
    distributed: normalizeDistributedOptions(options.distributed),
    scheduler: options.scheduler ?? defaultCronScheduler,
  };
}

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

export class CronModule {
  static forRoot(options: CronModuleOptions = {}): ModuleType {
    class CronModuleDefinition {}

    return defineModule(CronModuleDefinition, {
      exports: [SCHEDULING_REGISTRY],
      providers: createCronProviders(options),
    });
  }
}
