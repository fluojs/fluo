import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { ThrottlerGuard } from './guard.js';
import { THROTTLER_OPTIONS } from './tokens.js';
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
  ];
}

export class ThrottlerModule {
  static forRoot(options: ThrottlerModuleOptions): ModuleType {
    class ThrottlerRootModule extends ThrottlerModule {}

    return defineModule(ThrottlerRootModule, {
      exports: [ThrottlerGuard],
      global: true,
      providers: createThrottlerProviders(options),
    });
  }
}
