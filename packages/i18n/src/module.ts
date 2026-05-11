import { Inject } from '@fluojs/core';
import { defineModuleMetadata, type ModuleMetadata } from '@fluojs/core/internal';

import { snapshotI18nModuleOptions } from './options.js';
import { I18nService } from './service.js';
import type { I18nModuleOptions } from './types.js';

const I18N_MODULE_OPTIONS = Symbol('fluo.i18n.module-options');

@Inject(I18N_MODULE_OPTIONS)
class I18nServiceFactory extends I18nService {
  constructor(options: I18nModuleOptions) {
    super(options);
  }
}

/**
 * Module facade that registers the fluo-native core i18n service surface.
 */
export class I18nModule {
  /**
   * Creates a module class that registers `I18nService` with captured root options.
   *
   * @param options Root i18n module options for catalogs, fallback behavior, and service registration.
   * @returns A module type that can be listed in `imports` during bootstrap.
   *
   * @example
   * ```ts
   * @Module({
   *   imports: [I18nModule.forRoot({ defaultLocale: 'en' })],
   * })
   * class AppModule {}
   * ```
   */
  static forRoot(options?: I18nModuleOptions): new () => I18nModule {
    const moduleOptions = snapshotI18nModuleOptions(options);
    class I18nModuleImpl extends I18nModule {}
    const providers: NonNullable<ModuleMetadata['providers']> = [
      {
        provide: I18N_MODULE_OPTIONS,
        useValue: moduleOptions,
      },
      {
        provide: I18nService,
        useClass: I18nServiceFactory,
      },
    ];

    defineModuleMetadata(I18nModuleImpl, {
      global: moduleOptions.global ?? true,
      exports: [I18nService],
      providers,
    });

    return I18nModuleImpl;
  }
}
