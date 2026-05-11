import { I18nError } from '../errors.js';
import type { I18nLocale, I18nMessageTree, I18nTranslationKey } from '../types.js';

const SAFE_LOCALE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?(?:-[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?)*$/;
const SAFE_NAMESPACE_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

/**
 * Optional per-load controls shared by i18n catalog loaders.
 */
export interface I18nLoaderLoadOptions {
  /** Optional cancellation signal for loaders that can cancel in-flight work. */
  readonly signal?: AbortSignal;
}

/**
 * Loader contract for asynchronous locale and namespace catalog sources.
 */
export interface I18nLoader {
  /**
   * Loads one locale and namespace catalog tree.
   *
   * @param locale Locale identifier to load.
   * @param namespace Namespace identifier to load.
   * @param options Optional per-load controls such as cancellation.
   * @returns A detached immutable i18n message tree.
   */
  load(locale: I18nLocale, namespace: I18nTranslationKey, options?: I18nLoaderLoadOptions): Promise<I18nMessageTree>;
}

/**
 * Checks whether a value is a plain object suitable for loader option or catalog validation.
 *
 * @param value Candidate value to inspect.
 * @returns `true` when the value is a plain object or null-prototype object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates a loader locale before a backend is called.
 *
 * @param locale Candidate locale value supplied by the loader caller.
 * @param label Loader label used in stable error messages.
 * @returns Nothing when the locale is valid.
 */
export function validateLoaderLocale(locale: unknown, label: string): asserts locale is I18nLocale {
  if (typeof locale !== 'string' || locale.trim() === '' || !SAFE_LOCALE_PATTERN.test(locale)) {
    throw new I18nError(`${label} locale must be a safe non-empty locale segment.`, 'I18N_INVALID_LOADER_OPTIONS');
  }
}

/**
 * Validates a loader namespace before a backend is called.
 *
 * @param namespace Candidate namespace value supplied by the loader caller.
 * @param label Loader label used in stable error messages.
 * @returns Nothing when the namespace is valid.
 */
export function validateLoaderNamespace(namespace: unknown, label: string): asserts namespace is I18nTranslationKey {
  if (typeof namespace !== 'string' || namespace.trim() === '') {
    throw new I18nError(`${label} namespace must be a safe non-empty namespace path.`, 'I18N_INVALID_LOADER_OPTIONS');
  }

  const normalized = namespace.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.endsWith('/') || normalized.includes('//')) {
    throw new I18nError(`${label} namespace must be a relative namespace path.`, 'I18N_INVALID_LOADER_OPTIONS');
  }

  for (const segment of normalized.split('/')) {
    if (segment === '.' || segment === '..' || !SAFE_NAMESPACE_SEGMENT_PATTERN.test(segment)) {
      throw new I18nError(`${label} namespace contains an unsafe path segment.`, 'I18N_INVALID_LOADER_OPTIONS');
    }
  }
}

/**
 * Creates a detached immutable message tree from untrusted loader output.
 *
 * @param value Untrusted catalog-like value returned by a loader backend.
 * @param path Diagnostic path used in validation errors.
 * @returns A frozen message tree detached from caller-owned data.
 */
export function snapshotLoaderMessageTree(value: unknown, path: string): I18nMessageTree {
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
      snapshot[key] = snapshotLoaderMessageTree(entry, `${path}.${key}`);
      continue;
    }

    throw new I18nError(`${path}.${key} must be a string or nested message tree.`, 'I18N_INVALID_CATALOG');
  }

  return Object.freeze(snapshot);
}
