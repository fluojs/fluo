import { snapshotI18nModuleOptions } from './options.js';
import type { I18nModuleOptions } from './types.js';

/**
 * Minimal i18n service placeholder that owns the root package configuration snapshot.
 *
 * @remarks
 * Translation lookup, locale negotiation, loaders, adapters, and formatter integration are intentionally out of
 * scope for the initial scaffold. Later i18n issues can extend this service without widening the root exports first.
 */
export class I18nService {
  private readonly options: I18nModuleOptions;

  /**
   * Creates a service with a detached options snapshot.
   *
   * @param options Root i18n options captured at the application boundary.
   */
  constructor(options: I18nModuleOptions = {}) {
    this.options = snapshotI18nModuleOptions(options);
  }

  /**
   * Returns a detached copy of the root i18n options snapshot.
   *
   * @returns The captured i18n module options without exposing mutable service internals.
   */
  snapshotOptions(): I18nModuleOptions {
    return snapshotI18nModuleOptions(this.options);
  }
}

/**
 * Creates a standalone i18n service without registering a fluo module.
 *
 * @param options Root i18n options for the standalone service instance.
 * @returns An `I18nService` configured with a detached options snapshot.
 */
export function createI18n(options: I18nModuleOptions = {}): I18nService {
  return new I18nService(options);
}
