import { defineModuleMetadata } from '@fluojs/core/internal';

import { loadConfig } from './load.js';
import { snapshotConfigModuleOptions } from './options.js';
import { ConfigService, createConfigServiceFromSnapshot } from './service.js';
import type { ConfigModuleOptions } from './types.js';

/**
 * Module facade that wires normalized configuration into the application container.
 */
export class ConfigModule {
  /**
   * Creates a module class that registers `ConfigService` with one normalized configuration snapshot.
   *
   * @param options Configuration module options for env-file loading, validation, precedence, and scope.
   * @returns A module type that can be listed in `imports` during bootstrap.
   *
   * @example
   * ```ts
   * @Module({
   *   imports: [
   *     ConfigModule.forRoot({
   *       envFile: '.env',
   *       defaults: { PORT: '3000' },
   *     }),
   *   ],
   * })
   * class AppModule {}
   * ```
   */
  static forRoot(options?: ConfigModuleOptions): new () => ConfigModule {
    const loadOptions = snapshotConfigModuleOptions(options);
    class ConfigModuleImpl extends ConfigModule {}

    defineModuleMetadata(ConfigModuleImpl, {
      global: loadOptions.global ?? true,
      exports: [ConfigService],
      providers: [
        {
          provide: ConfigService,
          useFactory: () => createConfigServiceFromSnapshot(loadConfig(loadOptions)),
        },
      ],
    });

    return ConfigModuleImpl;
  }
}
