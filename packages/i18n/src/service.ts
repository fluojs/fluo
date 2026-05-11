import { snapshotI18nModuleOptions } from './options.js';
import { I18nError } from './errors.js';
import type { I18nFallbackLocales, I18nLocale, I18nMessageTree, I18nModuleOptions, I18nTranslateOptions } from './types.js';

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
