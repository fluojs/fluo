import { Inject } from '@fluojs/core';
import { defineModuleMetadata, type ModuleMetadata } from '@fluojs/core/internal';

import { createConfigReloader, loadConfig } from './load.js';
import { snapshotConfigModuleOptions } from './options.js';
import {
  ConfigService,
  createConfigServiceFromSnapshot,
  replaceConfigServiceSnapshotUnchecked,
} from './service.js';
import type { ConfigModuleOptions, ConfigReloader, ConfigReloadSubscription } from './types.js';

const CONFIG_MODULE_WATCH_OPTIONS = Symbol('fluo.config.module-watch-options');

@Inject(ConfigService, CONFIG_MODULE_WATCH_OPTIONS)
class ConfigModuleWatchManager {
  private reloader: ConfigReloader | undefined;
  private reloadForwarder: ConfigReloadSubscription | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly options: ConfigModuleOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.options.watch) {
      return;
    }

    if (this.reloader) {
      return;
    }

    this.reloader = createConfigReloader(this.options);
    this.reloadForwarder = this.reloader.subscribe((snapshot) => {
      const previousConfig = this.config.snapshot();

      try {
        replaceConfigServiceSnapshotUnchecked(this.config, snapshot);
      } catch (error: unknown) {
        replaceConfigServiceSnapshotUnchecked(this.config, previousConfig);
        throw error;
      }
    });
  }

  onModuleDestroy(): void {
    this.reloadForwarder?.unsubscribe();
    this.reloadForwarder = undefined;
    this.reloader?.close();
    this.reloader = undefined;
  }
}

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
    const providers: NonNullable<ModuleMetadata['providers']> = [
      {
        provide: ConfigService,
        useFactory: () => createConfigServiceFromSnapshot(loadConfig(loadOptions)),
      },
    ];

    if (loadOptions.watch) {
      providers.push(
        {
          provide: CONFIG_MODULE_WATCH_OPTIONS,
          useValue: loadOptions,
        },
        ConfigModuleWatchManager,
      );
    }

    defineModuleMetadata(ConfigModuleImpl, {
      global: loadOptions.global ?? true,
      exports: [ConfigService],
      providers,
    });

    return ConfigModuleImpl;
  }
}
