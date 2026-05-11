import { I18nError } from './errors.js';
import type { I18nFallbackLocales, I18nFormatOptions, I18nMessageCatalogs, I18nMessageTree, I18nModuleOptions } from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertLocale(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new I18nError(`${label} must be a non-empty string.`, 'I18N_INVALID_LOCALE_CONFIG');
  }
}

function assertLocaleList(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value)) {
    throw new I18nError(`${label} must be an array of locale strings.`, 'I18N_INVALID_LOCALE_CONFIG');
  }

  for (const locale of value) {
    assertLocale(locale, label);
  }
}

function assertSupportedLocale(locale: string, supportedLocales: readonly string[] | undefined, label: string): void {
  if (supportedLocales !== undefined && !supportedLocales.includes(locale)) {
    throw new I18nError(`${label} must be listed in supportedLocales.`, 'I18N_INVALID_LOCALE_CONFIG');
  }
}

function snapshotIntlOptions(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    throw new I18nError(`${path} must be a plain object option bag.`, 'I18N_INVALID_OPTIONS');
  }

  return Object.freeze({ ...value });
}

function snapshotNamedIntlFormats(value: unknown, path: string): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new I18nError(`${path} must be a named format map.`, 'I18N_INVALID_OPTIONS');
  }

  const snapshot: Record<string, Readonly<Record<string, unknown>>> = {};

  for (const [name, options] of Object.entries(value)) {
    if (name.trim() === '') {
      throw new I18nError(`${path} contains an empty format name.`, 'I18N_INVALID_OPTIONS');
    }

    snapshot[name] = snapshotIntlOptions(options, `${path}.${name}`);
  }

  return Object.freeze(snapshot);
}

function snapshotFormats(formats: I18nFormatOptions | undefined): I18nFormatOptions | undefined {
  if (formats === undefined) {
    return undefined;
  }

  if (!isPlainObject(formats)) {
    throw new I18nError('formats must be a plain object when provided.', 'I18N_INVALID_OPTIONS');
  }

  return Object.freeze({
    dateTime: snapshotNamedIntlFormats(formats.dateTime, 'formats.dateTime') as I18nFormatOptions['dateTime'],
    list: snapshotNamedIntlFormats(formats.list, 'formats.list') as I18nFormatOptions['list'],
    number: snapshotNamedIntlFormats(formats.number, 'formats.number') as I18nFormatOptions['number'],
    relativeTime: snapshotNamedIntlFormats(formats.relativeTime, 'formats.relativeTime') as I18nFormatOptions['relativeTime'],
  });
}

function snapshotMessageTree(value: unknown, path: string): I18nMessageTree {
  if (!isPlainObject(value)) {
    throw new I18nError(`${path} must be a plain object message tree.`, 'I18N_INVALID_CATALOG');
  }

  const snapshot: Record<string, string | I18nMessageTree> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key.trim() === '') {
      throw new I18nError(`${path} contains an empty message key segment.`, 'I18N_INVALID_CATALOG');
    }

    if (typeof entry === 'string') {
      snapshot[key] = entry;
      continue;
    }

    if (isPlainObject(entry)) {
      snapshot[key] = snapshotMessageTree(entry, `${path}.${key}`);
      continue;
    }

    throw new I18nError(`${path}.${key} must be a string or nested message tree.`, 'I18N_INVALID_CATALOG');
  }

  return Object.freeze(snapshot);
}

function snapshotCatalogs(
  catalogs: I18nMessageCatalogs | undefined,
  supportedLocales: readonly string[] | undefined,
): I18nMessageCatalogs | undefined {
  if (catalogs === undefined) {
    return undefined;
  }

  if (!isPlainObject(catalogs)) {
    throw new I18nError('catalogs must be a locale-scoped object.', 'I18N_INVALID_CATALOG');
  }

  const snapshot: Record<string, I18nMessageTree> = {};

  for (const [locale, tree] of Object.entries(catalogs)) {
    assertLocale(locale, 'catalog locale');
    assertSupportedLocale(locale, supportedLocales, 'catalog locale');
    snapshot[locale] = snapshotMessageTree(tree, `catalogs.${locale}`);
  }

  return Object.freeze(snapshot);
}

function snapshotFallbackLocales(
  fallbackLocales: I18nFallbackLocales | undefined,
  supportedLocales: readonly string[] | undefined,
): I18nFallbackLocales | undefined {
  if (fallbackLocales === undefined) {
    return undefined;
  }

  if (Array.isArray(fallbackLocales)) {
    assertLocaleList(fallbackLocales, 'fallbackLocales');
    for (const fallbackLocale of fallbackLocales) {
      assertSupportedLocale(fallbackLocale, supportedLocales, 'fallbackLocales locale');
    }
    return Object.freeze([...fallbackLocales]);
  }

  if (!isPlainObject(fallbackLocales)) {
    throw new I18nError('fallbackLocales must be an array or locale map.', 'I18N_INVALID_LOCALE_CONFIG');
  }

  const snapshot: Record<string, readonly string[]> = {};

  for (const [locale, chain] of Object.entries(fallbackLocales)) {
    assertLocale(locale, 'fallbackLocales locale');
    assertSupportedLocale(locale, supportedLocales, 'fallbackLocales locale');
    assertLocaleList(chain, `fallbackLocales.${locale}`);
    for (const fallbackLocale of chain) {
      assertSupportedLocale(fallbackLocale, supportedLocales, `fallbackLocales.${locale} locale`);
    }
    snapshot[locale] = Object.freeze([...chain]);
  }

  return Object.freeze(snapshot);
}

function validateModuleOptions(options: I18nModuleOptions): void {
  if (!isPlainObject(options)) {
    throw new I18nError('i18n module options must be a plain object.', 'I18N_INVALID_OPTIONS');
  }

  if (options.defaultLocale !== undefined) {
    assertLocale(options.defaultLocale, 'defaultLocale');
  }

  if (options.global !== undefined && typeof options.global !== 'boolean') {
    throw new I18nError('global must be a boolean when provided.', 'I18N_INVALID_OPTIONS');
  }

  if (options.missingMessage !== undefined && typeof options.missingMessage !== 'function') {
    throw new I18nError('missingMessage must be a function when provided.', 'I18N_INVALID_OPTIONS');
  }

  if (options.formats !== undefined && !isPlainObject(options.formats)) {
    throw new I18nError('formats must be a plain object when provided.', 'I18N_INVALID_OPTIONS');
  }

  if (options.supportedLocales !== undefined) {
    assertLocaleList(options.supportedLocales, 'supportedLocales');

    if (options.defaultLocale !== undefined) {
      assertSupportedLocale(options.defaultLocale, options.supportedLocales, 'defaultLocale');
    }
  }

  if (options.catalogs !== undefined && options.defaultLocale === undefined) {
    throw new I18nError('defaultLocale is required when catalogs are configured.', 'I18N_INVALID_OPTIONS');
  }
}

/**
 * Creates a detached copy of root i18n module options.
 *
 * @param options Root i18n module options provided by the caller.
 * @returns A detached options snapshot for module registration or standalone service creation.
 */
export function snapshotI18nModuleOptions(options: I18nModuleOptions = {}): I18nModuleOptions {
  validateModuleOptions(options);

  return Object.freeze({
    ...options,
    catalogs: snapshotCatalogs(options.catalogs, options.supportedLocales),
    fallbackLocales: snapshotFallbackLocales(options.fallbackLocales, options.supportedLocales),
    formats: snapshotFormats(options.formats),
    supportedLocales: options.supportedLocales ? Object.freeze([...options.supportedLocales]) : undefined,
  });
}
