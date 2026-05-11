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
  | 'I18N_INVALID_LOADER_OPTIONS'
  | 'I18N_INVALID_LOCALE_CONFIG'
  | 'I18N_INVALID_OPTIONS'
  | 'I18N_MISSING_CATALOG'
  | 'I18N_MISSING_MESSAGE';

/**
 * Named `Intl.DateTimeFormat` option bags captured during i18n registration.
 */
export type I18nNamedDateTimeFormats = Readonly<Record<string, Intl.DateTimeFormatOptions>>;

/**
 * Named `Intl.NumberFormat` option bags captured during i18n registration.
 */
export type I18nNamedNumberFormats = Readonly<Record<string, Intl.NumberFormatOptions>>;

/**
 * Named `Intl.ListFormat` option bags captured during i18n registration.
 */
export type I18nNamedListFormats = Readonly<Record<string, Intl.ListFormatOptions>>;

/**
 * Named `Intl.RelativeTimeFormat` option bags captured during i18n registration.
 */
export type I18nNamedRelativeTimeFormats = Readonly<Record<string, Intl.RelativeTimeFormatOptions>>;

/**
 * Reusable named option groups for standard `Intl` formatters.
 */
export interface I18nFormatOptions {
  /** Named date/time format option bags. */
  readonly dateTime?: I18nNamedDateTimeFormats;
  /** Named number, currency, and percent format option bags. */
  readonly number?: I18nNamedNumberFormats;
  /** Named list format option bags. */
  readonly list?: I18nNamedListFormats;
  /** Named relative time format option bags. */
  readonly relativeTime?: I18nNamedRelativeTimeFormats;
}

/**
 * Common per-call options for helpers backed by standard `Intl` formatters.
 */
export interface I18nFormatterOptions {
  /** Locale passed directly to the underlying `Intl` formatter. */
  readonly locale: I18nLocale;
  /** Optional named format option bag registered in `I18nModuleOptions.formats`. */
  readonly format?: string;
}

/**
 * Per-call date/time formatting options.
 */
export interface I18nDateTimeFormatOptions extends I18nFormatterOptions {
  /** Inline `Intl.DateTimeFormat` options merged after the named option bag. */
  readonly options?: Intl.DateTimeFormatOptions;
}

/**
 * Per-call number, currency, and percent formatting options.
 */
export interface I18nNumberFormatOptions extends I18nFormatterOptions {
  /** Inline `Intl.NumberFormat` options merged after the named option bag. */
  readonly options?: Intl.NumberFormatOptions;
}

/**
 * Per-call currency formatting options.
 */
export interface I18nCurrencyFormatOptions extends I18nNumberFormatOptions {
  /** ISO 4217 currency code passed to `Intl.NumberFormat`. */
  readonly currency: string;
}

/**
 * Per-call list formatting options.
 */
export interface I18nListFormatOptions extends I18nFormatterOptions {
  /** Inline `Intl.ListFormat` options merged after the named option bag. */
  readonly options?: Intl.ListFormatOptions;
}

/**
 * Per-call relative time formatting options.
 */
export interface I18nRelativeTimeFormatOptions extends I18nFormatterOptions {
  /** Inline `Intl.RelativeTimeFormat` options merged after the named option bag. */
  readonly options?: Intl.RelativeTimeFormatOptions;
}

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
  /** Reusable named `Intl` formatter option bags captured as immutable service-owned snapshots. */
  formats?: I18nFormatOptions;
  /** Whether the module should expose `I18nService` globally. Defaults to `true`. */
  global?: boolean;
}
