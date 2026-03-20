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
  processEnv: NodeJS.ProcessEnv;
  safeProcessEnv: Record<string, string>;
  runtimeOverrides: ConfigDictionary;
  parse?: (content: string) => Record<string, string>;
  validate?: (raw: ConfigDictionary) => ConfigDictionary;
}

function parseEnvContent(content: string, processEnv: NodeJS.ProcessEnv, customParser?: (content: string) => Record<string, string>): Record<string, string> {
  if (customParser) {
    return customParser(content);
  }
  const parsed = dotenvParse(content);
  const safeProcessEnv: Record<string, string> = Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const result = dotenvExpand({ parsed, processEnv: safeProcessEnv });
  return result.parsed ?? {};
}

function sanitizeProcessEnv(processEnv: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function normalizeLoadOptions(options: ConfigLoadOptions): NormalizedLoadOptions {
  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFile ?? join(cwd, `.env.${options.mode}`);
  const defaults = options.defaults ?? {};
  const processEnv = options.processEnv ?? process.env;
  const safeProcessEnv = sanitizeProcessEnv(processEnv);
  const runtimeOverrides = options.runtimeOverrides ?? {};

  return {
    defaults,
    envFile,
    parse: options.parse,
    processEnv,
    runtimeOverrides,
    safeProcessEnv,
    validate: options.validate,
  };
}

function readEnvFileValues(options: NormalizedLoadOptions): ConfigDictionary {
  if (!existsSync(options.envFile)) {
    return {};
  }

  return parseEnvContent(readFileSync(options.envFile, 'utf8'), options.processEnv, options.parse);
}

function buildMergedConfig(options: NormalizedLoadOptions): ConfigDictionary {
  const envFileValues = readEnvFileValues(options);

  return {
    ...options.defaults,
    ...envFileValues,
    ...options.safeProcessEnv,
    ...options.runtimeOverrides,
  };
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

export function createConfigReloader(options: ConfigLoadOptions): ConfigReloader {
  const normalized = normalizeLoadOptions(options);
  let current = resolveConfig(normalized);
  let watcher: FSWatcher | undefined;
  const listeners = new Set<ConfigReloadListener>();
  const errorListeners = new Set<ConfigReloadErrorListener>();

  const notifyReload = (snapshot: ConfigDictionary, reason: ConfigReloadReason): void => {
    const clonedSnapshot = cloneConfigDictionary(snapshot);

    for (const listener of listeners) {
      listener(clonedSnapshot, reason);
    }
  };

  const notifyError = (error: unknown, reason: ConfigReloadReason): void => {
    for (const listener of errorListeners) {
      listener(error, reason);
    }
  };

  const applyReload = (reason: ConfigReloadReason): ConfigDictionary => {
    const next = resolveConfig(normalized);
    current = next;
    notifyReload(next, reason);
    return cloneConfigDictionary(next);
  };

  if (options.watch && existsSync(normalized.envFile)) {
    watcher = watch(normalized.envFile, { persistent: false }, () => {
      try {
        applyReload('watch');
      } catch (error: unknown) {
        notifyError(error, 'watch');
      }
    });
  }

  return {
    close(): void {
      if (watcher) {
        watcher.close();
        watcher = undefined;
      }

      listeners.clear();
      errorListeners.clear();
    },
    current(): ConfigDictionary {
      return cloneConfigDictionary(current);
    },
    reload(): ConfigDictionary {
      return applyReload('manual');
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
