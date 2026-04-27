import { FluoError } from '@fluojs/core';

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
   * @throws {FluoError} When the key is absent (`code: 'CONFIG_KEY_MISSING'`).
   */
  getOrThrow<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {
    const value = this._resolve(key as string);

    if (value === undefined) {
      throw new FluoError(`Missing config key: ${String(key)}`, { code: 'CONFIG_KEY_MISSING' });
    }

    return value as DotValue<T, K & string>;
  }

  /**
   * Returns a deep-cloned snapshot of the current normalized config dictionary.
   *
   * @returns A detached deep clone of the current configuration snapshot.
   */
  snapshot(): ConfigDictionary {
    return cloneConfigDictionary(this.values);
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

/**
 * Replaces the underlying configuration snapshot of a `ConfigService`.
 *
 * @param service The `ConfigService` instance to update.
 * @param values The new configuration dictionary.
 */
export function replaceConfigServiceSnapshot<T extends Record<string, unknown>>(
  service: ConfigService<T>,
  values: T,
): void {
  service['values'] = cloneConfigDictionary(values);
}

/**
 * Replaces the underlying configuration snapshot with an already-detached value.
 *
 * @param service The `ConfigService` instance to update.
 * @param values A trusted configuration dictionary that must not be mutated after adoption.
 */
export function replaceConfigServiceSnapshotUnchecked<T extends Record<string, unknown>>(
  service: ConfigService<T>,
  values: T,
): void {
  service['values'] = values;
}

/**
 * Creates a `ConfigService` by adopting an already-detached configuration snapshot.
 *
 * @param values A trusted configuration dictionary produced by the config loader.
 * @returns A `ConfigService` backed by the provided snapshot without an additional constructor clone.
 */
export function createConfigServiceFromSnapshot<T extends Record<string, unknown>>(values: T): ConfigService<T> {
  const service = Object.create(ConfigService.prototype) as ConfigService<T>;
  service['values'] = values;

  return service;
}
