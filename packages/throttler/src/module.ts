import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { ThrottlerGuard } from './guard.js';
import { THROTTLER_GUARD, THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions } from './types.js';

export function createThrottlerProviders(options: ThrottlerModuleOptions): Provider[] {
  return [
    {
      provide: THROTTLER_OPTIONS,
      useValue: options,
    },
    {
      provide: THROTTLER_GUARD,
      useClass: ThrottlerGuard,
    },
  ];
}

export function createThrottlerModule(options: ThrottlerModuleOptions): ModuleType {
  class ThrottlerModule {}

  return defineModule(ThrottlerModule, {
    exports: [THROTTLER_GUARD],
    global: true,
    providers: createThrottlerProviders(options),
  });
}
