import type { Provider } from '@fluojs/di';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { ThrottlerGuard } from './guard.js';
import { THROTTLER_OPTIONS } from './tokens.js';
import type { ThrottlerModuleOptions } from './types.js';
import { validateThrottlerModuleOptions } from './validation.js';

function createThrottlerProviders(options: ThrottlerModuleOptions): Provider[] {
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
 *
 * @remarks
 * The module wires one global `ThrottlerGuard`; route-level overrides still come
 * from `@Throttle(...)` and `@SkipThrottle()` metadata.
 */
export class ThrottlerModule {
  /**
   * Register the global throttling guard with validated module options.
   *
   * @param options Module-wide throttling policy.
   * @returns A runtime module exporting `ThrottlerGuard`.
   *
   * @example
   * ```ts
   * ThrottlerModule.forRoot({
   *   ttl: 60,
   *   limit: 10,
   * });
   * ```
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
