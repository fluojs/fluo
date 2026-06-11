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
 * Runtime module entrypoint for throttler policy and guard provider registration.
 *
 * @remarks
 * The module registers validated throttler options and makes `ThrottlerGuard`
 * injectable. Routes still opt in to enforcement explicitly with guard metadata
 * such as `@UseGuards(ThrottlerGuard)`.
 */
export class ThrottlerModule {
  /**
   * Register throttler providers with validated module options.
   *
   * @param options Module-wide throttling policy.
   * @returns A runtime module exporting `ThrottlerGuard` for explicit route activation.
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
      global: options.global ?? true,
      providers: createThrottlerProviders(options),
    });
  }
}
