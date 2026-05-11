/**
 * Locale identifier accepted by the initial i18n package surface.
 */
export type I18nLocale = string;

/**
 * Translation key identifier reserved for later translation behavior.
 */
export type I18nTranslationKey = string;

/**
 * Stable i18n package error codes for caller-visible failures.
 */
export type I18nErrorCode = 'I18N_ERROR';

/**
 * Root i18n module options captured during package registration.
 */
export interface I18nModuleOptions {
  /** Default locale that later translation behavior can use as the primary language. */
  defaultLocale?: I18nLocale;
  /** Supported locale list reserved for future locale selection and validation behavior. */
  supportedLocales?: readonly I18nLocale[];
  /** Whether the module should expose `I18nService` globally. Defaults to `true`. */
  global?: boolean;
}
