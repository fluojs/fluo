import { existsSync, readFileSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { KonektiError } from '@konekti/core';
import { parse as dotenvParse } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';

import { cloneConfigDictionary } from './clone.js';
import type {
  ConfigDictionary,
  ConfigLoadOptions,
  ConfigReloadErrorListener,
  ConfigReloader,
  ConfigReloadListener,
  ConfigReloadReason,
  ConfigReloadSubscription,
} from './types.js';

interface NormalizedLoadOptions {
  envFile: string;
  defaults: ConfigDictionary;
  safeProcessEnv: Record<string, string>;
  runtimeOverrides: ConfigDictionary;
  parse?: (content: string) => Record<string, string>;
  validate?: (raw: ConfigDictionary) => ConfigDictionary;
}

function parseEnvContent(content: string, safeProcessEnv: Record<string, string>, customParser?: (content: string) => Record<string, string>): Record<string, string> {
  if (customParser) {
    return customParser(content);
  }
  const parsed = dotenvParse(content);
  const result = dotenvExpand({ parsed, processEnv: { ...safeProcessEnv } });
  return result.parsed ?? {};
}

function sanitizeProcessEnv(processEnv: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function normalizeLoadOptions(options: ConfigLoadOptions): NormalizedLoadOptions {
  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFilePath ?? options.envFile ?? join(cwd, '.env');
  const defaults = options.defaults ?? {};
  const processEnv = options.processEnv ?? process.env;
  const safeProcessEnv = sanitizeProcessEnv(processEnv);
  const runtimeOverrides = options.runtimeOverrides ?? {};

  return {
    defaults,
    envFile,
    parse: options.parse,
    runtimeOverrides,
    safeProcessEnv,
    validate: options.validate,
  };
}

function readEnvFileValues(options: NormalizedLoadOptions): ConfigDictionary {
  if (!existsSync(options.envFile)) {
    return {};
  }

  return parseEnvContent(readFileSync(options.envFile, 'utf8'), options.safeProcessEnv, options.parse);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfigEntries(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = merged[key];

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      merged[key] = mergeConfigEntries(targetValue, sourceValue);
      continue;
    }

    merged[key] = cloneConfigDictionary(sourceValue);
  }

  return merged;
}

function mergeConfigSources(...sources: ConfigDictionary[]): ConfigDictionary {
  let merged: Record<string, unknown> = {};

  for (const source of sources) {
    merged = mergeConfigEntries(merged, source);
  }

  return merged;
}

function buildMergedConfig(options: NormalizedLoadOptions): ConfigDictionary {
  const envFileValues = readEnvFileValues(options);

  return mergeConfigSources(
    options.defaults,
    envFileValues,
    options.safeProcessEnv,
    options.runtimeOverrides,
  );
}

function validateConfig(options: NormalizedLoadOptions, merged: ConfigDictionary): ConfigDictionary {
  try {
    return options.validate ? options.validate(merged) : merged;
  } catch (error: unknown) {
    throw new KonektiError('Invalid configuration.', {
      code: 'INVALID_CONFIG',
      cause: error,
    });
  }
}

function resolveConfig(options: NormalizedLoadOptions): ConfigDictionary {
  return validateConfig(options, buildMergedConfig(options));
}

function createSubscription<T>(listeners: Set<T>, listener: T): ConfigReloadSubscription {
  listeners.add(listener);

  return {
    unsubscribe(): void {
      listeners.delete(listener);
    },
  };
}

type ReloaderState = {
  current: ConfigDictionary;
  watcher: FSWatcher | undefined;
};

function notifyReloadListeners(
  listeners: ReadonlySet<ConfigReloadListener>,
  snapshot: ConfigDictionary,
  reason: ConfigReloadReason,
): void {
  for (const listener of listeners) {
    listener(cloneConfigDictionary(snapshot), reason);
  }
}

function notifyReloadErrorListeners(
  listeners: ReadonlySet<ConfigReloadErrorListener>,
  error: unknown,
  reason: ConfigReloadReason,
): void {
  for (const listener of listeners) {
    listener(error, reason);
  }
}

function applyReload(
  normalized: NormalizedLoadOptions,
  state: ReloaderState,
  listeners: ReadonlySet<ConfigReloadListener>,
  reason: ConfigReloadReason,
): ConfigDictionary {
  const previous = state.current;
  const next = resolveConfig(normalized);

  state.current = next;

  try {
    notifyReloadListeners(listeners, next, reason);
  } catch (error) {
    state.current = previous;
    throw error;
  }

  return cloneConfigDictionary(next);
}

function startReloaderWatcher(
  normalized: NormalizedLoadOptions,
  options: ConfigLoadOptions,
  state: ReloaderState,
  listeners: ReadonlySet<ConfigReloadListener>,
  errorListeners: ReadonlySet<ConfigReloadErrorListener>,
): FSWatcher | undefined {
  if (!options.watch || !existsSync(normalized.envFile)) {
    return undefined;
  }

  return watch(normalized.envFile, { persistent: false }, () => {
    try {
      applyReload(normalized, state, listeners, 'watch');
    } catch (error: unknown) {
      notifyReloadErrorListeners(errorListeners, error, 'watch');
    }
  });
}

function closeReloader(
  state: ReloaderState,
  listeners: Set<ConfigReloadListener>,
  errorListeners: Set<ConfigReloadErrorListener>,
): void {
  if (state.watcher) {
    state.watcher.close();
    state.watcher = undefined;
  }

  listeners.clear();
  errorListeners.clear();
}

export function createConfigReloader(options: ConfigLoadOptions): ConfigReloader {
  const normalized = normalizeLoadOptions(options);
  const state: ReloaderState = {
    current: resolveConfig(normalized),
    watcher: undefined,
  };
  const listeners = new Set<ConfigReloadListener>();
  const errorListeners = new Set<ConfigReloadErrorListener>();

  state.watcher = startReloaderWatcher(normalized, options, state, listeners, errorListeners);

  return {
    close(): void {
      closeReloader(state, listeners, errorListeners);
    },
    current(): ConfigDictionary {
      return cloneConfigDictionary(state.current);
    },
    reload(): ConfigDictionary {
      return applyReload(normalized, state, listeners, 'manual');
    },
    subscribe(listener: ConfigReloadListener): ConfigReloadSubscription {
      return createSubscription(listeners, listener);
    },
    subscribeError(listener: ConfigReloadErrorListener): ConfigReloadSubscription {
      return createSubscription(errorListeners, listener);
    },
  };
}

export function loadConfig(options: ConfigLoadOptions): ConfigDictionary {
  return cloneConfigDictionary(resolveConfig(normalizeLoadOptions(options)));
}
