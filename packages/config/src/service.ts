import { KonektiError } from '@konekti/core';

import { cloneConfigDictionary } from './clone.js';
import type { ConfigDictionary, DotPaths, DotValue } from './types.js';

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

export class ConfigService<T extends Record<string, unknown> = ConfigDictionary> {
  private values: T;

  constructor(values: T) {
    this.values = cloneConfigDictionary(values);
  }

  get<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {
    return this._resolve(key as string) as DotValue<T, K & string> | undefined;
  }

  getOrThrow<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {
    const value = this._resolve(key as string);

    if (value === undefined) {
      throw new KonektiError(`Missing config key: ${String(key)}`, { code: 'CONFIG_KEY_MISSING' });
    }

    return value as DotValue<T, K & string>;
  }

  /**
   * @deprecated Use `get()` instead. `get()` now returns `T | undefined` matching NestJS semantics.
   */
  getOptional<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {
    return this._resolve(key as string) as DotValue<T, K & string> | undefined;
  }

  snapshot(): ConfigDictionary {
    return cloneConfigDictionary(this.values);
  }

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
