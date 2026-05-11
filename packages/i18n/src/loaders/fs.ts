import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { I18nError } from '../errors.js';
import type { I18nLocale, I18nMessageTree, I18nTranslationKey } from '../types.js';

const SAFE_LOCALE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?(?:-[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)*$/;
const SAFE_NAMESPACE_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWithinDirectory(rootDir: string, targetPath: string): boolean {
  const relativePath = relative(rootDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function validateLocale(locale: unknown): asserts locale is I18nLocale {
  if (typeof locale !== 'string' || locale.trim() === '' || !SAFE_LOCALE_PATTERN.test(locale)) {
    throw new I18nError('Filesystem i18n locale must be a safe non-empty locale segment.', 'I18N_INVALID_LOADER_OPTIONS');
  }
}

function validateNamespace(namespace: unknown): asserts namespace is I18nTranslationKey {
  if (typeof namespace !== 'string' || namespace.trim() === '') {
    throw new I18nError('Filesystem i18n namespace must be a safe non-empty namespace path.', 'I18N_INVALID_LOADER_OPTIONS');
  }

  const normalized = namespace.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.endsWith('/') || normalized.includes('//')) {
    throw new I18nError('Filesystem i18n namespace must be a relative namespace path.', 'I18N_INVALID_LOADER_OPTIONS');
  }

  for (const segment of normalized.split('/')) {
    if (segment === '.' || segment === '..' || !SAFE_NAMESPACE_SEGMENT_PATTERN.test(segment)) {
      throw new I18nError('Filesystem i18n namespace contains an unsafe path segment.', 'I18N_INVALID_LOADER_OPTIONS');
    }
  }
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

/**
 * Loader contract for asynchronous locale and namespace catalog sources.
 */
export interface I18nLoader {
  /**
   * Loads one locale and namespace catalog tree.
   *
   * @param locale Locale directory to load from.
   * @param namespace Namespace JSON file path without extension.
   * @returns A detached immutable i18n message tree.
   */
  load(locale: I18nLocale, namespace: I18nTranslationKey): Promise<I18nMessageTree>;
}

/**
 * Options for the Node-only filesystem i18n catalog loader.
 */
export interface FileSystemI18nLoaderOptions {
  /** Root catalog directory containing locale subdirectories. */
  readonly rootDir: string;
}

/**
 * Node-only JSON catalog loader for `@fluojs/i18n/loaders/fs`.
 *
 * @remarks
 * Catalogs are read from `${rootDir}/${locale}/${namespace}.json`. Locale and namespace inputs are
 * validated before disk reads, and the resolved path must remain inside `rootDir`.
 */
export class FileSystemI18nLoader implements I18nLoader {
  private readonly rootDir: string;

  /**
   * Creates a filesystem-backed JSON catalog loader.
   *
   * @param options Loader options with an absolute or relative root catalog directory.
   */
  constructor(options: FileSystemI18nLoaderOptions) {
    if (!isPlainObject(options) || typeof options.rootDir !== 'string' || options.rootDir.trim() === '') {
      throw new I18nError('Filesystem i18n loader rootDir must be a non-empty string.', 'I18N_INVALID_LOADER_OPTIONS');
    }

    this.rootDir = resolve(options.rootDir);
  }

  /**
   * Loads and validates one JSON message catalog from disk.
   *
   * @param locale Locale directory to load from.
   * @param namespace Namespace JSON file path without extension.
   * @returns A detached immutable i18n message tree.
   * @throws {I18nError} When inputs are unsafe, the file is missing, JSON is malformed, or catalog shape is invalid.
   */
  async load(locale: I18nLocale, namespace: I18nTranslationKey): Promise<I18nMessageTree> {
    validateLocale(locale);
    validateNamespace(namespace);

    const namespacePath = namespace.replaceAll('/', sep);
    const catalogPath = resolve(this.rootDir, locale, `${namespacePath}.json`);

    if (!isWithinDirectory(this.rootDir, catalogPath)) {
      throw new I18nError('Filesystem i18n catalog path escapes rootDir.', 'I18N_INVALID_LOADER_OPTIONS');
    }

    let raw: string;
    try {
      raw = await readFile(catalogPath, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new I18nError(`Missing i18n catalog file: ${locale}/${namespace}.json`, 'I18N_MISSING_CATALOG');
      }

      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new I18nError(`Malformed i18n catalog JSON: ${locale}/${namespace}.json`, 'I18N_INVALID_CATALOG');
    }

    return snapshotMessageTree(parsed, `catalogs.${locale}.${namespace}`);
  }
}

/**
 * Creates a Node-only filesystem JSON catalog loader.
 *
 * @param options Loader options with the root catalog directory.
 * @returns A filesystem-backed i18n loader instance.
 */
export function createFileSystemI18nLoader(options: FileSystemI18nLoaderOptions): FileSystemI18nLoader {
  return new FileSystemI18nLoader(options);
}
