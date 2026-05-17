import { I18nError } from './errors.js';
import type { I18nMessageTree } from './types.js';

/**
 * Checks whether a value is a plain object suitable for i18n option or catalog validation.
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
 * Creates a detached immutable message tree from untrusted catalog-like input.
 *
 * @param value Catalog-like value to validate and snapshot.
 * @param path Diagnostic path used in validation errors.
 * @returns A frozen message tree detached from caller-owned data.
 */
export function snapshotMessageTree(value: unknown, path: string): I18nMessageTree {
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
 * Resolves a direct or dot-path message from an immutable i18n message tree.
 *
 * @param tree Locale-scoped catalog tree to inspect.
 * @param key Direct key or dot-path key to resolve.
 * @returns The resolved message string, or `undefined` when the key is absent or not a string leaf.
 */
export function resolveCatalogMessage(tree: I18nMessageTree | undefined, key: string): string | undefined {
  if (tree === undefined) {
    return undefined;
  }

  if (Object.hasOwn(tree, key)) {
    const direct = tree[key];
    return typeof direct === 'string' ? direct : undefined;
  }

  let current: unknown = tree;

  for (const part of key.split('.')) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) {
      return undefined;
    }

    current = current[part];
  }

  return typeof current === 'string' ? current : undefined;
}
