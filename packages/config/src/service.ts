import { KonektiError } from '@konekti/core';

import type { ConfigDictionary, DotPaths, DotValue } from './types.js';

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

export class ConfigService<T extends Record<string, unknown> = ConfigDictionary> {
  constructor(private readonly values: T) {}

  get<K extends DotPaths<T>>(key: K): DotValue<T, K & string> {
    const value = this._resolve(key as string);

    if (value === undefined) {
      throw new KonektiError(`Missing config key: ${String(key)}`, { code: 'CONFIG_KEY_MISSING' });
    }

    return value as DotValue<T, K & string>;
  }

  getOptional<K extends DotPaths<T>>(key: K): DotValue<T, K & string> | undefined {
    return this._resolve(key as string) as DotValue<T, K & string> | undefined;
  }

  snapshot(): ConfigDictionary {
    return { ...this.values };
  }

  private _resolve(key: string): unknown {
    if (hasOwn(this.values, key)) {
      return this.values[key];
    }
    const parts = key.split('.');
    let current: unknown = this.values;
    for (const part of parts) {
      if (!hasOwn(current, part)) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }
}
