import type { I18nModuleOptions } from './types.js';

/**
 * Creates a detached copy of root i18n module options.
 *
 * @param options Root i18n module options provided by the caller.
 * @returns A shallowly detached options snapshot for module registration or standalone service creation.
 */
export function snapshotI18nModuleOptions(options: I18nModuleOptions = {}): I18nModuleOptions {
  return {
    ...options,
    supportedLocales: options.supportedLocales ? [...options.supportedLocales] : undefined,
  };
}
