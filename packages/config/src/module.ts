import { defineModuleMetadata } from '@konekti/core';

import { loadConfig } from './load.js';
import { ConfigService } from './service.js';
import type { ConfigModuleOptions } from './types.js';

export class ConfigModule {
  static forRoot(options?: ConfigModuleOptions): new () => ConfigModule {
    class ConfigModuleImpl extends ConfigModule {}

    defineModuleMetadata(ConfigModuleImpl, {
      global: true,
      exports: [ConfigService],
      providers: [
        {
          provide: ConfigService,
          useFactory: () => new ConfigService(loadConfig(options ?? {})),
        },
      ],
    });

    return ConfigModuleImpl;
  }
}
