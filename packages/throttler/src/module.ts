import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { ThrottlerGuard } from './guard.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions } from './types.js';
import { validateThrottlerModuleOptions } from './validation.js';

/**
 * Create the throttler provider set for manual module composition.
 *
 * @param options Module-wide throttling policy.
 * @returns Providers for validated options and `ThrottlerGuard`.
 */
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

/**
 * Runtime module entrypoint for global throttling.
 */
export class ThrottlerModule {
  /**
   * Register the global throttling guard with validated module options.
   *
   * @param options Module-wide throttling policy.
   * @returns A runtime module exporting `ThrottlerGuard`.
   */
  static forRoot(options: ThrottlerModuleOptions): ModuleType {
    class ThrottlerRootModule extends ThrottlerModule {}

    return defineModule(ThrottlerRootModule, {
      exports: [ThrottlerGuard],
      global: true,
      providers: createThrottlerProviders(options),
    });
  }
}
