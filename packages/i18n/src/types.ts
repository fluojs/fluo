/**
 * Locale identifier accepted by the i18n package surface.
 */
export type I18nLocale = string;

/**
 * Dot-path translation key resolved from a locale-scoped message catalog.
 */
export type I18nTranslationKey = string;

/**
 * Stable i18n package error codes for caller-visible failures.
 */
export type I18nErrorCode =
  | 'I18N_ERROR'
  | 'I18N_INVALID_CATALOG'
  | 'I18N_INVALID_LOCALE_CONFIG'
  | 'I18N_INVALID_OPTIONS'
  | 'I18N_MISSING_MESSAGE';

/**
 * Interpolation values available to simple `{{ name }}` placeholders.
 */
export type I18nInterpolationValues = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Nested message tree for one locale.
 */
export interface I18nMessageTree {
  /** Message leaf or nested message tree keyed by path segment. */
  readonly [key: string]: string | I18nMessageTree;
}

/**
 * Canonical locale-scoped catalog map consumed by the core translation service.
 */
export type I18nMessageCatalogs = Readonly<Record<I18nLocale, I18nMessageTree>>;

/**
 * Fallback locale chain applied globally or per requested locale.
 */
export type I18nFallbackLocales = readonly I18nLocale[] | Readonly<Record<I18nLocale, readonly I18nLocale[]>>;

/**
 * Context passed to the missing-message hook after catalog/default fallback resolution fails.
 */
export interface I18nMissingMessageContext {
  /** Requested locale supplied explicitly by the translation caller. */
  readonly locale: I18nLocale;
  /** Translation key after optional namespace prefixing. */
  readonly key: I18nTranslationKey;
  /** Deterministic locale chain inspected before the hook was invoked. */
  readonly attemptedLocales: readonly I18nLocale[];
  /** Interpolation values supplied by the caller. */
  readonly values?: I18nInterpolationValues;
}

/**
 * Hook invoked when no message and no default value can satisfy a translation request.
 */
export type I18nMissingMessageHandler = (context: I18nMissingMessageContext) => string | undefined;

/**
 * Per-call translation options. Locale is always explicit in the framework-agnostic core.
 */
export interface I18nTranslateOptions {
  /** Locale to resolve first. */
  readonly locale: I18nLocale;
  /** Optional namespace prefix, resolved as `${namespace}.${key}`. */
  readonly namespace?: I18nTranslationKey;
  /** Values interpolated into `{{ name }}` placeholders. */
  readonly values?: I18nInterpolationValues;
  /** Caller-provided fallback returned before the missing-message hook is invoked. */
  readonly defaultValue?: string;
}

/**
 * Root i18n module options captured during package registration.
 */
export interface I18nModuleOptions {
  /** Default fallback locale used after the configured locale chain. */
  defaultLocale?: I18nLocale;
  /** Locale-scoped message catalogs. */
  catalogs?: I18nMessageCatalogs;
  /** Supported locale allow-list for configuration and per-call locale validation. */
  supportedLocales?: readonly I18nLocale[];
  /** Global or per-locale deterministic fallback chain inspected before the default locale. */
  fallbackLocales?: I18nFallbackLocales;
  /** Hook invoked when no catalog entry and no default value can satisfy a translation request. */
  missingMessage?: I18nMissingMessageHandler;
  /** Whether the module should expose `I18nService` globally. Defaults to `true`. */
  global?: boolean;
}
