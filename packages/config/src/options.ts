import { cloneConfigDictionary } from './clone.js';
import type { ConfigDictionary, ConfigLoadOptions, ConfigModuleOptions, ConfigSchema } from './types.js';

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

function snapshotConfigSchema(schema: ConfigSchema | undefined): ConfigSchema | undefined {
  if (schema === undefined) {
    return undefined;
  }

  const standard = schema['~standard'];
  const snapshot = {
    '~standard': Object.freeze({
      types: standard.types,
      validate: standard.validate,
      vendor: standard.vendor,
      version: standard.version,
    }),
  } satisfies ConfigSchema;

  return Object.freeze(snapshot);
}

/**
 * Creates a detached snapshot of config module registration options.
 *
 * @param options Caller-owned module options captured at registration time.
 * @returns Options that cannot observe later caller mutations of config dictionaries or schema objects.
 */
export function snapshotConfigModuleOptions(options?: ConfigModuleOptions): ConfigModuleOptions {
  if (options === undefined) {
    return {};
  }

  return Object.freeze({
    ...options,
    defaults: snapshotConfigDictionary(options.defaults),
    processEnv: snapshotProcessEnv(options.processEnv),
    runtimeOverrides: snapshotConfigDictionary(options.runtimeOverrides),
    schema: snapshotConfigSchema(options.schema),
  });
}

/**
 * Creates a detached snapshot of config load and reload options.
 *
 * @param options Caller-owned load options captured by loaders or reload modules.
 * @returns Options that preserve registration-time config dictionary and schema inputs.
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
    schema: snapshotConfigSchema(options.schema),
  });
}
