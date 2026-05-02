import { cloneConfigDictionary } from './clone.js';
import type { ConfigDictionary, ConfigLoadOptions, ConfigModuleOptions } from './types.js';

function snapshotConfigDictionary(value: ConfigDictionary | undefined): ConfigDictionary | undefined {
  return value === undefined ? undefined : cloneConfigDictionary(value);
}

function snapshotProcessEnv(processEnv: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
  if (processEnv === undefined) {
    return undefined;
  }

  const snapshot: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) {
      snapshot[key] = value;
    }
  }

  return Object.freeze(snapshot);
}

/**
 * Creates a detached snapshot of config module registration options.
 *
 * @param options Caller-owned module options captured at registration time.
 * @returns Options that cannot observe later caller mutations of config dictionaries.
 */
export function snapshotConfigModuleOptions(options?: ConfigModuleOptions): ConfigModuleOptions {
  if (options === undefined) {
    return {};
  }

  return Object.freeze({
    ...options,
    defaults: snapshotConfigDictionary(options.defaults),
    processEnv: snapshotProcessEnv(options.processEnv),
  });
}

/**
 * Creates a detached snapshot of config load and reload options.
 *
 * @param options Caller-owned load options captured by loaders or reload modules.
 * @returns Options that preserve registration-time config dictionary inputs.
 */
export function snapshotConfigLoadOptions(options?: ConfigLoadOptions): ConfigLoadOptions {
  if (options === undefined) {
    return {};
  }

  return Object.freeze({
    ...options,
    defaults: snapshotConfigDictionary(options.defaults),
    processEnv: snapshotProcessEnv(options.processEnv),
    runtimeOverrides: snapshotConfigDictionary(options.runtimeOverrides),
  });
}
