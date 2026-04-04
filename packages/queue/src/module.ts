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

export function createQueueProviders(options: QueueModuleOptions = {}): Provider[] {
  return [
    {
      provide: QUEUE_OPTIONS,
      useValue: normalizeQueueModuleOptions(options),
    },
    {
      provide: QUEUE,
      useClass: QueueLifecycleService,
    },
  ];
}

export class QueueModule {
  static forRoot(options: QueueModuleOptions = {}): ModuleType {
    class QueueModuleDefinition {}

    return defineModule(QueueModuleDefinition, {
      exports: [QUEUE],
      global: true,
      providers: createQueueProviders(options),
    });
  }
}
