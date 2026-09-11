import { Inject, InvariantError } from '@fluojs/core';
import { defineModuleMetadata, type ModuleMetadata } from '@fluojs/core/internal';

import { cloneConfigDictionary } from './clone.js';
import { ConfigReloadCore, normalizeConfigLoadOptions, resolveConfigSnapshot } from './load.js';
import { snapshotConfigModuleOptions } from './options.js';
import {
  ConfigService,
  createConfigServiceFromSnapshot,
  replaceConfigServiceSnapshotUnchecked,
} from './service.js';
import type {
  ConfigDictionary,
  ConfigLoadOptions,
  ConfigModuleOptions,
  ConfigReloadErrorListener,
  ConfigReloader,
  ConfigReloadListener,
  ConfigReloadSubscription,
} from './types.js';

const CONFIG_MODULE_OPTIONS = Symbol('fluo.config.module-options');

/**
 * Injection token for ConfigModule's shared manual reload and subscription contract.
 */
export const CONFIG_RELOADER = Symbol('fluo.config.reloader');

function createSubscription<T>(listeners: Set<T>, listener: T): ConfigReloadSubscription {
  listeners.add(listener);

  return {
    unsubscribe(): void {
      listeners.delete(listener);
    },
  };
}

/**
 * Coordinates ConfigModule's injectable reload contract while preserving ConfigService identity.
 *
 * @remarks
 * `close()` and `onModuleDestroy()` are terminal. After shutdown the manager never creates another
 * reloader or watcher, `onApplicationBootstrap()` becomes a no-op, and `current()` keeps returning the
 * last committed `ConfigService` snapshot.
 */
@Inject(ConfigService, CONFIG_MODULE_OPTIONS)
export class ConfigReloadManager implements ConfigReloader {
  private closed = false;
  private reloader: ConfigReloader | undefined;
  private reloadForwarder: ConfigReloadSubscription | undefined;
  private errorForwarder: ConfigReloadSubscription | undefined;
  private readonly reloadListeners = new Set<ConfigReloadListener>();
  private readonly errorListeners = new Set<ConfigReloadErrorListener>();

  constructor(
    private readonly config: ConfigService,
    private readonly options: ConfigLoadOptions,
  ) {}

  /**
   * Creates a standalone reload manager with its own `ConfigService`.
   *
   * @param options Configuration loading options captured before any reload work begins.
   * @returns A terminally closable manager that owns manual reload and subscription state.
   */
  static create(options: ConfigLoadOptions): ConfigReloadManager {
    const loadOptions = snapshotConfigModuleOptions(options);
    const manager = new ConfigReloadManager(
      createConfigServiceFromSnapshot(ConfigModule.load(loadOptions)),
      loadOptions,
    );

    manager.ensureReloader();
    manager.onApplicationBootstrap();
    return manager;
  }

  current(): ConfigDictionary {
    return this.config.snapshot();
  }

  reload(): ConfigDictionary {
    this.assertNotClosed('reload');

    return this.ensureReloader().reload();
  }

  subscribe(listener: ConfigReloadListener): ConfigReloadSubscription {
    this.assertNotClosed('subscribe');

    return createSubscription(this.reloadListeners, listener);
  }

  subscribeError(listener: ConfigReloadErrorListener): ConfigReloadSubscription {
    this.assertNotClosed('subscribeError');

    return createSubscription(this.errorListeners, listener);
  }

  close(): void {
    this.closed = true;
    this.reloadForwarder?.unsubscribe();
    this.reloadForwarder = undefined;
    this.errorForwarder?.unsubscribe();
    this.errorForwarder = undefined;
    this.reloader?.close();
    this.reloader = undefined;
    this.reloadListeners.clear();
    this.errorListeners.clear();
  }

  onApplicationBootstrap(): void {
    if (this.closed || !this.options.watch) {
      return;
    }

    const reloader = this.ensureReloader(true);
    replaceConfigServiceSnapshotUnchecked(this.config, reloader.current());
  }

  onModuleDestroy(): void {
    this.close();
  }

  private assertNotClosed(operation: 'reload' | 'subscribe' | 'subscribeError'): void {
    if (this.closed) {
      throw new InvariantError(`Config reload manager cannot ${operation} after shutdown has started.`);
    }
  }

  private ensureReloader(refreshForWatchBootstrap = false): ConfigReloader {
    if (this.reloader) {
      return this.reloader;
    }

    const initialSnapshot = refreshForWatchBootstrap ? undefined : this.config.snapshot();
    const reloader = ConfigReloadCore.create(this.options, initialSnapshot);

    this.reloadForwarder = reloader.subscribe((snapshot, reason) => {
      const previousConfig = this.config.snapshot();

      try {
        replaceConfigServiceSnapshotUnchecked(this.config, snapshot);
        for (const listener of this.reloadListeners) {
          listener(cloneConfigDictionary(snapshot), reason);
        }
      } catch (error: unknown) {
        replaceConfigServiceSnapshotUnchecked(this.config, previousConfig);
        throw error;
      }
    });
    this.errorForwarder = reloader.subscribeError((error, reason) => {
      this.options.onReloadError?.(error, reason);
      for (const listener of this.errorListeners) {
        listener(error, reason);
      }
    });
    this.reloader = reloader;

    return reloader;
  }
}

/**
 * Module facade that wires normalized configuration into the application container.
 */
export class ConfigModule {
  /**
   * Loads and validates a standalone configuration snapshot without registering a module.
   *
   * @param options Configuration loading options for explicit sources and validation.
   * @returns A detached normalized configuration dictionary.
   */
  static load(options: ConfigLoadOptions): ConfigDictionary {
    const normalized = normalizeConfigLoadOptions(options);
    return cloneConfigDictionary(resolveConfigSnapshot(normalized));
  }

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
     *       envFilePaths: ['.env'],
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
        useFactory: () => createConfigServiceFromSnapshot(ConfigModule.load(loadOptions)),
      },
      {
        provide: CONFIG_MODULE_OPTIONS,
        useValue: loadOptions,
      },
      ConfigReloadManager,
      {
        provide: CONFIG_RELOADER,
        useExisting: ConfigReloadManager,
      },
    ];

    defineModuleMetadata(ConfigModuleImpl, {
      global: loadOptions.global ?? true,
      exports: [ConfigService, CONFIG_RELOADER],
      providers,
    });

    return ConfigModuleImpl;
  }
}
