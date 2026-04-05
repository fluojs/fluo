import { KonektiError } from '@konekti/core';

import { cloneConfigDictionary } from './clone.js';
import type { ConfigDictionary, DotPaths, DotValue } from './types.js';

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

/**
 * Typed read-only facade over the normalized runtime configuration dictionary.
 */
export class ConfigService<T extends Record<string, unknown> = ConfigDictionary> {
  private values: T;

  constructor(values: T) {
    this.values = cloneConfigDictionary(values);
  }

  /**
   * Returns a config value by key (including dot-path keys) or `undefined` when missing.
   *
   * @param key Configuration key or dot-path key to resolve from the current snapshot.
   * @returns The resolved value clone for object-like entries, or `undefined` when the key does not exist.
   */
  get<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {
    return this._resolve(key as string) as DotValue<T, K & string> | undefined;
  }

  /**
   * Returns a config value by key and throws when the key is missing.
   *
   * @param key Configuration key or dot-path key that must exist in the current snapshot.
   * @returns The resolved value clone for object-like entries.
   * @throws {KonektiError} When the key is absent (`code: 'CONFIG_KEY_MISSING'`).
   */
  getOrThrow<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {
    const value = this._resolve(key as string);

    if (value === undefined) {
      throw new KonektiError(`Missing config key: ${String(key)}`, { code: 'CONFIG_KEY_MISSING' });
    }

    return value as DotValue<T, K & string>;
  }

  /**
   * @deprecated Use `get()` instead. `get()` now returns `T | undefined` matching NestJS semantics.
   *
   * @param key Configuration key or dot-path key to resolve from the current snapshot.
   * @returns The resolved value clone for object-like entries, or `undefined` when the key does not exist.
   */
  getOptional<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {
    return this._resolve(key as string) as DotValue<T, K & string> | undefined;
  }

  /**
   * Returns a deep-cloned snapshot of the current normalized config dictionary.
   *
   * @returns A detached deep clone of the current configuration snapshot.
   */
  snapshot(): ConfigDictionary {
    return cloneConfigDictionary(this.values);
  }

  /**
   * Replaces the internal snapshot used by this service (runtime reload flow).
   *
   * @param values Next validated configuration dictionary to store as the internal snapshot.
   * @returns `void`.
   */
  _replaceSnapshot(values: T): void {
    this.values = cloneConfigDictionary(values);
  }

  private _resolve(key: string): unknown {
    let resolved: unknown;

    if (hasOwn(this.values, key)) {
      resolved = this.values[key];
    } else {
      const parts = key.split('.');
      let current: unknown = this.values;
      for (const part of parts) {
        if (!hasOwn(current, part)) {
          return undefined;
        }
        current = current[part];
      }
      resolved = current;
    }

    if (typeof resolved === 'object' && resolved !== null) {
      return cloneConfigDictionary(resolved);
    }

    return resolved;
  }
}
