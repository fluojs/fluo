import { Inject, InvariantError } from '@fluojs/core';
import { defineModuleMetadata } from '@fluojs/core/internal';

import { cloneConfigDictionary } from './clone.js';
import { createConfigReloader } from './load.js';
import { snapshotConfigLoadOptions } from './options.js';
import {
  ConfigService,
  replaceConfigServiceSnapshotUnchecked,
} from './service.js';
import type {
  ConfigDictionary,
  ConfigLoadOptions,
  ConfigReloadErrorListener,
  ConfigReloader,
  ConfigReloadListener,
  ConfigReloadSubscription,
} from './types.js';

const CONFIG_RELOAD_OPTIONS = Symbol('fluo.config.reload-options');

/**
 * Exposes the config reload manager contract for dependency injection.
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
 * Lazily creates and coordinates the active config reloader instance.
 *
 * @remarks
 * `close()` and `onModuleDestroy()` are terminal. After shutdown the manager never creates another
 * reloader or watcher, `onApplicationBootstrap()` becomes a no-op, and `current()` keeps returning the
 * last committed `ConfigService` snapshot.
 *
 * @throws {InvariantError} When `reload()`, `subscribe()`, or `subscribeError()` is called after shutdown.
 */
@Inject(ConfigService, CONFIG_RELOAD_OPTIONS)
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

    if (this.reloader) {
      this.reloader.close();
      this.reloader = undefined;
    }

    this.reloadListeners.clear();
    this.errorListeners.clear();
  }

  onApplicationBootstrap(): void {
    if (this.closed || !this.options.watch) {
      return;
    }

    this.ensureReloader();
  }

  onModuleDestroy(): void {
    this.close();
  }

  private assertNotClosed(operation: 'reload' | 'subscribe' | 'subscribeError'): void {
    if (this.closed) {
      throw new InvariantError(`Config reload manager cannot ${operation} after shutdown has started.`);
    }
  }

  private ensureReloader(): ConfigReloader {
    if (this.reloader) {
      return this.reloader;
    }

    const reloader = createConfigReloader(this.options);

    this.reloadForwarder = reloader.subscribe((nextConfig, reason) => {
      const previousConfig = this.config.snapshot();

      try {
        replaceConfigServiceSnapshotUnchecked(this.config, nextConfig);

        for (const listener of this.reloadListeners) {
          listener(cloneConfigDictionary(nextConfig), reason);
        }
      } catch (error: unknown) {
        replaceConfigServiceSnapshotUnchecked(this.config, previousConfig);
        throw error;
      }
    });
    this.errorForwarder = reloader.subscribeError((error, reason) => {
      for (const listener of this.errorListeners) {
        listener(error, reason);
      }
    });
    this.reloader = reloader;

    return reloader;
  }
}

/**
 * Registers config reload services and exports the shared reloader token.
 */
export class ConfigReloadModule {
  static forRoot(options?: ConfigLoadOptions): new () => ConfigReloadModule {
    const loadOptions = snapshotConfigLoadOptions(options);

    class ConfigReloadModuleImpl extends ConfigReloadModule {}

    defineModuleMetadata(ConfigReloadModuleImpl, {
      exports: [CONFIG_RELOADER],
      providers: [
        {
          provide: CONFIG_RELOAD_OPTIONS,
          useValue: loadOptions,
        },
        ConfigReloadManager,
        {
          provide: CONFIG_RELOADER,
          useExisting: ConfigReloadManager,
        },
      ],
    });

    return ConfigReloadModuleImpl;
  }
}
