import { snapshotI18nModuleOptions } from './options.js';
import { I18nError } from './errors.js';
import type {
  I18nCurrencyFormatOptions,
  I18nDateTimeFormatOptions,
  I18nFallbackLocales,
  I18nListFormatOptions,
  I18nLocale,
  I18nMessageTree,
  I18nModuleOptions,
  I18nNumberFormatOptions,
  I18nRelativeTimeFormatOptions,
  I18nTranslateOptions,
} from './types.js';

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTranslationKey(key: unknown, namespace: unknown): string {
  if (typeof key !== 'string') {
    throw new I18nError('Translation key must be a string.', 'I18N_INVALID_OPTIONS');
  }

  if (key.trim() === '') {
    throw new I18nError('Translation key must be a non-empty string.', 'I18N_INVALID_OPTIONS');
  }

  if (namespace === undefined) {
    return key;
  }

  if (typeof namespace !== 'string') {
    throw new I18nError('Translation namespace must be a string when provided.', 'I18N_INVALID_OPTIONS');
  }

  if (namespace.trim() === '') {
    throw new I18nError('Translation namespace must be a non-empty string when provided.', 'I18N_INVALID_OPTIONS');
  }

  return `${namespace}.${key}`;
}

function assertInterpolationValues(values: unknown): asserts values is I18nTranslateOptions['values'] {
  if (values !== undefined && !isPlainObject(values)) {
    throw new I18nError('Translation values must be a plain object when provided.', 'I18N_INVALID_OPTIONS');
  }
}

function assertDefaultValue(defaultValue: unknown): asserts defaultValue is string | undefined {
  if (defaultValue !== undefined && typeof defaultValue !== 'string') {
    throw new I18nError('Translation defaultValue must be a string when provided.', 'I18N_INVALID_OPTIONS');
  }
}

function assertFormatterOptions(options: unknown, label: string): asserts options is { readonly locale: I18nLocale; readonly format?: string } {
  if (!isPlainObject(options)) {
    throw new I18nError(`${label} options are required.`, 'I18N_INVALID_OPTIONS');
  }

  if (typeof options.locale !== 'string' || options.locale.trim() === '') {
    throw new I18nError(`${label} locale must be a non-empty string.`, 'I18N_INVALID_OPTIONS');
  }

  if (options.format !== undefined && (typeof options.format !== 'string' || options.format.trim() === '')) {
    throw new I18nError(`${label} format must be a non-empty string when provided.`, 'I18N_INVALID_OPTIONS');
  }
}

function assertIntlOptionBag(options: unknown, label: string): asserts options is object | undefined {
  if (options !== undefined && !isPlainObject(options)) {
    throw new I18nError(`${label} Intl options must be a plain object when provided.`, 'I18N_INVALID_OPTIONS');
  }
}

function assertCurrency(currency: unknown): asserts currency is string {
  if (typeof currency !== 'string' || currency.trim() === '') {
    throw new I18nError('Currency code must be a non-empty string.', 'I18N_INVALID_OPTIONS');
  }
}

function assertListValues(values: unknown): asserts values is readonly string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new I18nError('List values must be an array of strings.', 'I18N_INVALID_OPTIONS');
  }
}

function formatWithIntlErrorBoundary(label: string, action: () => string): string {
  try {
    return action();
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new I18nError(`${label} Intl options are invalid.`, 'I18N_INVALID_OPTIONS');
    }

    throw error;
  }
}

function interpolate(message: string, values: I18nTranslateOptions['values']): string {
  if (values === undefined) {
    return message;
  }

  return message.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      return placeholder;
    }

    const value = values[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolveMessage(tree: I18nMessageTree | undefined, key: string): string | undefined {
  if (tree === undefined) {
    return undefined;
  }

  if (hasOwn(tree, key)) {
    const direct = tree[key];
    return typeof direct === 'string' ? direct : undefined;
  }

  let current: unknown = tree;

  for (const part of key.split('.')) {
    if (!hasOwn(current, part)) {
      return undefined;
    }

    current = current[part];
  }

  return typeof current === 'string' ? current : undefined;
}

function pushUnique(locales: I18nLocale[], locale: I18nLocale | undefined): void {
  if (locale !== undefined && !locales.includes(locale)) {
    locales.push(locale);
  }
}

function isFallbackMap(value: I18nFallbackLocales): value is Readonly<Record<I18nLocale, readonly I18nLocale[]>> {
  return !Array.isArray(value);
}

/**
 * Framework-agnostic core translation service backed by locale-scoped message catalogs.
 *
 * @remarks
 * Locale selection is explicit per call. The core service performs deterministic catalog lookup and string
 * interpolation only; request locale detection, loaders, ICU/messageformat, and framework adapters remain out of scope.
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

  /**
   * Returns the deterministic locale chain used for a translation request.
   *
   * @param locale Explicit caller locale to resolve first.
   * @returns Locale chain ordered as requested locale, configured fallback chain, then default locale.
   * @throws {I18nError} When the locale is invalid or outside `supportedLocales`.
   */
  resolveLocales(locale: I18nLocale): readonly I18nLocale[] {
    if (typeof locale !== 'string' || locale.trim() === '') {
      throw new I18nError('Translation locale must be a non-empty string.', 'I18N_INVALID_OPTIONS');
    }

    if (this.options.supportedLocales !== undefined && !this.options.supportedLocales.includes(locale)) {
      throw new I18nError(`Unsupported i18n locale: ${locale}`, 'I18N_INVALID_OPTIONS');
    }

    const chain: I18nLocale[] = [];
    pushUnique(chain, locale);

    if (Array.isArray(this.options.fallbackLocales)) {
      for (const fallbackLocale of this.options.fallbackLocales) {
        pushUnique(chain, fallbackLocale);
      }
    } else if (this.options.fallbackLocales !== undefined && isFallbackMap(this.options.fallbackLocales)) {
      for (const fallbackLocale of this.options.fallbackLocales[locale] ?? []) {
        pushUnique(chain, fallbackLocale);
      }
    }

    pushUnique(chain, this.options.defaultLocale);

    return Object.freeze(chain);
  }

  private resolveNamedOptions<T extends object>(
    formats: Readonly<Record<string, T>> | undefined,
    name: string | undefined,
    label: string,
  ): T | undefined {
    if (name === undefined) {
      return undefined;
    }

    const options = formats?.[name];

    if (options === undefined) {
      throw new I18nError(`Unknown ${label} format: ${name}`, 'I18N_INVALID_OPTIONS');
    }

    return options;
  }

  /**
   * Formats a date or timestamp for an explicit locale using `Intl.DateTimeFormat`.
   *
   * @param value Date instance or epoch timestamp accepted by `Intl.DateTimeFormat`.
   * @param options Explicit locale, optional named format, and inline date/time options.
   * @returns Locale-formatted date/time text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named date/time format is missing.
   */
  formatDateTime(value: Date | number, options: I18nDateTimeFormatOptions): string {
    assertFormatterOptions(options, 'Date/time formatter');
    assertIntlOptionBag(options.options, 'Date/time formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.dateTime, options.format, 'dateTime');
    return formatWithIntlErrorBoundary('Date/time formatter', () =>
      new Intl.DateTimeFormat(options.locale, { ...namedOptions, ...options.options }).format(value),
    );
  }

  /**
   * Formats a number for an explicit locale using `Intl.NumberFormat`.
   *
   * @param value Number value passed to `Intl.NumberFormat`.
   * @param options Explicit locale, optional named format, and inline number options.
   * @returns Locale-formatted number text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named number format is missing.
   */
  formatNumber(value: number, options: I18nNumberFormatOptions): string {
    assertFormatterOptions(options, 'Number formatter');
    assertIntlOptionBag(options.options, 'Number formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.number, options.format, 'number');
    return formatWithIntlErrorBoundary('Number formatter', () =>
      new Intl.NumberFormat(options.locale, { ...namedOptions, ...options.options }).format(value),
    );
  }

  /**
   * Formats a currency amount for an explicit locale using `Intl.NumberFormat`.
   *
   * @param value Currency amount passed to `Intl.NumberFormat`.
   * @param options Explicit locale, ISO 4217 currency code, optional named format, and inline number options.
   * @returns Locale-formatted currency text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named number format is missing.
   */
  formatCurrency(value: number, options: I18nCurrencyFormatOptions): string {
    assertFormatterOptions(options, 'Currency formatter');
    assertCurrency(options.currency);
    assertIntlOptionBag(options.options, 'Currency formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.number, options.format, 'number');
    return formatWithIntlErrorBoundary('Currency formatter', () =>
      new Intl.NumberFormat(options.locale, {
        ...namedOptions,
        ...options.options,
        currency: options.currency,
        style: 'currency',
      }).format(value),
    );
  }

  /**
   * Formats a ratio as a percent for an explicit locale using `Intl.NumberFormat`.
   *
   * @param value Ratio value passed to `Intl.NumberFormat` with `style: 'percent'`.
   * @param options Explicit locale, optional named format, and inline number options.
   * @returns Locale-formatted percent text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named number format is missing.
   */
  formatPercent(value: number, options: I18nNumberFormatOptions): string {
    assertFormatterOptions(options, 'Percent formatter');
    assertIntlOptionBag(options.options, 'Percent formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.number, options.format, 'number');
    return formatWithIntlErrorBoundary('Percent formatter', () =>
      new Intl.NumberFormat(options.locale, { ...namedOptions, ...options.options, style: 'percent' }).format(value),
    );
  }

  /**
   * Formats a string list for an explicit locale using `Intl.ListFormat`.
   *
   * @param values List item strings passed to `Intl.ListFormat`.
   * @param options Explicit locale, optional named format, and inline list options.
   * @returns Locale-formatted list text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named list format is missing.
   */
  formatList(values: readonly string[], options: I18nListFormatOptions): string {
    assertListValues(values);
    assertFormatterOptions(options, 'List formatter');
    assertIntlOptionBag(options.options, 'List formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.list, options.format, 'list');
    return formatWithIntlErrorBoundary('List formatter', () =>
      new Intl.ListFormat(options.locale, { ...namedOptions, ...options.options }).format(values),
    );
  }

  /**
   * Formats a relative time value for an explicit locale using `Intl.RelativeTimeFormat`.
   *
   * @param value Numeric offset passed to `Intl.RelativeTimeFormat`.
   * @param unit Relative time unit such as `day`, `hour`, or `minute`.
   * @param options Explicit locale, optional named format, and inline relative time options.
   * @returns Locale-formatted relative time text from the host standard `Intl` implementation.
   * @throws {I18nError} When options are invalid or a named relative time format is missing.
   */
  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options: I18nRelativeTimeFormatOptions): string {
    assertFormatterOptions(options, 'Relative time formatter');
    assertIntlOptionBag(options.options, 'Relative time formatter');
    this.resolveLocales(options.locale);

    const namedOptions = this.resolveNamedOptions(this.options.formats?.relativeTime, options.format, 'relativeTime');
    return formatWithIntlErrorBoundary('Relative time formatter', () =>
      new Intl.RelativeTimeFormat(options.locale, { ...namedOptions, ...options.options }).format(value, unit),
    );
  }

  /**
   * Resolves and interpolates a catalog message for an explicit locale.
   *
   * @param key Dot-path catalog key, optionally prefixed by `options.namespace`.
   * @param options Per-call locale, interpolation values, and default value.
   * @returns The resolved catalog message, default value, or missing-message hook result.
   * @throws {I18nError} When options are invalid or the message cannot be resolved.
   */
  translate(key: string, options: I18nTranslateOptions): string {
    if (options === undefined || typeof options !== 'object' || options === null) {
      throw new I18nError('Translation options are required.', 'I18N_INVALID_OPTIONS');
    }

    assertInterpolationValues(options.values);
    assertDefaultValue(options.defaultValue);

    const resolvedKey = normalizeTranslationKey(key, options.namespace);
    const locales = this.resolveLocales(options.locale);

    for (const locale of locales) {
      const message = resolveMessage(this.options.catalogs?.[locale], resolvedKey);

      if (message !== undefined) {
        return interpolate(message, options.values);
      }
    }

    if (options.defaultValue !== undefined) {
      return interpolate(options.defaultValue, options.values);
    }

    const missing = this.options.missingMessage?.({
      attemptedLocales: locales,
      key: resolvedKey,
      locale: options.locale,
      values: options.values,
    });

    if (missing !== undefined) {
      return interpolate(missing, options.values);
    }

    throw new I18nError(`Missing i18n message: ${resolvedKey}`, 'I18N_MISSING_MESSAGE');
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
