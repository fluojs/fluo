import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { ThrottlerGuard } from './guard.js';
import { THROTTLER_GUARD, THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions } from './types.js';
import { validateThrottlerModuleOptions } from './validation.js';

export function createThrottlerProviders(options: ThrottlerModuleOptions): Provider[] {
  const validatedOptions = validateThrottlerModuleOptions(options);

  return [
    {
      provide: THROTTLER_OPTIONS,
      useValue: validatedOptions,
    },
    {
      provide: ThrottlerGuard,
      useClass: ThrottlerGuard,
    },
    {
      provide: THROTTLER_GUARD,
      useExisting: ThrottlerGuard,
    },
  ];
}

export function createThrottlerModule(options: ThrottlerModuleOptions): ModuleType {
  class ThrottlerModule {}

  return defineModule(ThrottlerModule, {
    exports: [ThrottlerGuard, THROTTLER_GUARD],
    global: true,
    providers: createThrottlerProviders(options),
  });
}
