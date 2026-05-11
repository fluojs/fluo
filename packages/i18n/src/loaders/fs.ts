import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { I18nError } from '../errors.js';
import type { I18nLocale, I18nMessageTree, I18nTranslationKey } from '../types.js';
import { isPlainObject, snapshotLoaderMessageTree, validateLoaderLocale, validateLoaderNamespace } from './shared.js';
import type { I18nLoader } from './shared.js';

function isWithinDirectory(rootDir: string, targetPath: string): boolean {
  const relativePath = relative(rootDir, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export type { I18nLoader, I18nLoaderLoadOptions } from './shared.js';

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
    validateLoaderLocale(locale, 'Filesystem i18n');
    validateLoaderNamespace(namespace, 'Filesystem i18n');

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

    return snapshotLoaderMessageTree(parsed, `catalogs.${locale}.${namespace}`);
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
