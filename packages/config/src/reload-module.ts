import { Inject, defineModuleMetadata } from '@konekti/core';

import { cloneConfigDictionary } from './clone.js';
import { createConfigReloader } from './load.js';
import { ConfigService } from './service.js';
import type {
  ConfigDictionary,
  ConfigLoadOptions,
  ConfigReloadErrorListener,
  ConfigReloader,
  ConfigReloadListener,
  ConfigReloadSubscription,
} from './types.js';

const CONFIG_RELOAD_OPTIONS = Symbol('konekti.config.reload-options');

export const CONFIG_RELOADER = Symbol('konekti.config.reloader');

function createSubscription<T>(listeners: Set<T>, listener: T): ConfigReloadSubscription {
  listeners.add(listener);

  return {
    unsubscribe(): void {
      listeners.delete(listener);
    },
  };
}

@Inject([ConfigService, CONFIG_RELOAD_OPTIONS])
class ConfigReloadManager implements ConfigReloader {
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
    return this.ensureReloader().current();
  }

  reload(): ConfigDictionary {
    return this.ensureReloader().reload();
  }

  subscribe(listener: ConfigReloadListener): ConfigReloadSubscription {
    return createSubscription(this.reloadListeners, listener);
  }

  subscribeError(listener: ConfigReloadErrorListener): ConfigReloadSubscription {
    return createSubscription(this.errorListeners, listener);
  }

  close(): void {
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
    if (!this.options.watch) {
      return;
    }

    this.ensureReloader();
  }

  onModuleDestroy(): void {
    this.close();
  }

  private ensureReloader(): ConfigReloader {
    if (this.reloader) {
      return this.reloader;
    }

    const reloader = createConfigReloader(this.options);

    this.reloadForwarder = reloader.subscribe((nextConfig, reason) => {
      const previousConfig = this.config.snapshot();

      try {
        this.config._replaceSnapshot(nextConfig);

        for (const listener of this.reloadListeners) {
          listener(cloneConfigDictionary(nextConfig), reason);
        }
      } catch (error: unknown) {
        this.config._replaceSnapshot(previousConfig);
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

export class ConfigReloadModule {
  static forRoot(options?: ConfigLoadOptions): new () => ConfigReloadModule {
    const loadOptions = options ?? {};

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
