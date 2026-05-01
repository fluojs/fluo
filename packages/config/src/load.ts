import type { FSWatcher } from 'node:fs';
import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

import { FluoError } from '@fluojs/core';
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
  ConfigSchema,
} from './types.js';

interface NormalizedLoadOptions {
  envFile: string;
  defaults: ConfigDictionary;
  safeProcessEnv: Record<string, string>;
  runtimeOverrides: ConfigDictionary;
  parse?: (content: string) => Record<string, string>;
  schema?: ConfigSchema;
}

type ConfigSchemaIssue = {
  readonly message: string;
  readonly path?: readonly unknown[];
};

type ConfigSchemaPathKeySegment = {
  readonly key: string | number | symbol;
};

type ConfigSchemaFailureResult = {
  readonly issues: readonly ConfigSchemaIssue[];
};

type ConfigSchemaSuccessResult = {
  readonly value: ConfigDictionary;
};

const reloadFailureReasons = new WeakMap<object, ConfigReloadReason>();

function markReloadFailure(error: unknown, reason: ConfigReloadReason): void {
  if (typeof error === 'object' && error !== null) {
    reloadFailureReasons.set(error, reason);
  }
}

function getReloadFailureReason(error: unknown): ConfigReloadReason | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  return reloadFailureReasons.get(error);
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

function rejectLegacyValidateOption(options: ConfigLoadOptions): void {
  if ('validate' in options) {
    throw new FluoError('Invalid configuration.', {
      code: 'INVALID_CONFIG',
      cause: new Error('The legacy `validate` option was removed. Use `schema` with a synchronous Standard Schema validator instead.'),
    });
  }
}

function normalizeLoadOptions(options: ConfigLoadOptions): NormalizedLoadOptions {
  rejectLegacyValidateOption(options);

  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFilePath ?? options.envFile ?? join(cwd, '.env');
  const defaults = options.defaults ?? {};
  const processEnv = options.processEnv ?? {};
  const safeProcessEnv = sanitizeProcessEnv(processEnv);
  const runtimeOverrides = options.runtimeOverrides ?? {};

  return {
    defaults,
    envFile,
    parse: options.parse,
    runtimeOverrides,
    safeProcessEnv,
    schema: options.schema,
  };
}

function readEnvFileValues(options: NormalizedLoadOptions): ConfigDictionary {
  try {
    return parseEnvContent(readFileSync(options.envFile, 'utf8'), options.safeProcessEnv, options.parse);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeConfigEntries(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      mergeConfigEntries(targetValue, sourceValue);
      continue;
    }

    if (isPlainObject(sourceValue)) {
      target[key] = mergeConfigEntries({}, sourceValue);
      continue;
    }

    target[key] = cloneConfigDictionary(sourceValue);
  }

  return target;
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
  );
}

function isConfigSchemaIssue(value: unknown): value is ConfigSchemaIssue {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}

function isConfigSchemaFailureResult(value: unknown): value is ConfigSchemaFailureResult {
  if (typeof value !== 'object' || value === null || !('issues' in value)) {
    return false;
  }

  return Array.isArray(value.issues) && value.issues.every(isConfigSchemaIssue);
}

function isConfigSchemaSuccessResult(value: unknown): value is ConfigSchemaSuccessResult {
  return typeof value === 'object' && value !== null && 'value' in value && isPlainObject(value.value);
}

function isConfigSchemaPathKeySegment(value: unknown): value is ConfigSchemaPathKeySegment {
  if (typeof value !== 'object' || value === null || !('key' in value)) {
    return false;
  }

  return typeof value.key === 'string' || typeof value.key === 'number' || typeof value.key === 'symbol';
}

function formatConfigSchemaPathSegment(segment: unknown): string | undefined {
  if (typeof segment === 'string' || typeof segment === 'number') {
    return String(segment);
  }

  if (isConfigSchemaPathKeySegment(segment)) {
    return String(segment.key);
  }

  return undefined;
}

function formatConfigSchemaIssue(issue: ConfigSchemaIssue): string {
  const path = issue.path
    ?.map(formatConfigSchemaPathSegment)
    .filter((segment): segment is string => segment !== undefined)
    .join('.');

  return path && path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

function createInvalidConfigError(cause: unknown, issues?: readonly ConfigSchemaIssue[]): FluoError {
  return new FluoError('Invalid configuration.', {
    code: 'INVALID_CONFIG',
    cause,
    meta: issues ? { issues: issues.map(formatConfigSchemaIssue) } : undefined,
  });
}

function isInvalidConfigError(error: unknown): error is FluoError {
  return error instanceof FluoError && error.code === 'INVALID_CONFIG';
}

function readConfigSchemaResult(result: unknown): ConfigDictionary {
  if (isConfigSchemaFailureResult(result)) {
    throw createInvalidConfigError(new Error('Standard Schema config validation failed.'), result.issues);
  }

  if (!isConfigSchemaSuccessResult(result)) {
    throw createInvalidConfigError(new Error('Standard Schema config validator returned a malformed result.'));
  }

  return result.value;
}

function validateConfig(options: NormalizedLoadOptions, merged: ConfigDictionary): ConfigDictionary {
  if (!options.schema) {
    return merged;
  }

  try {
    const result = options.schema['~standard'].validate(merged);

    if (isPromiseLike(result)) {
      throw new Error('Config schemas must validate synchronously. Async Standard Schema validation is not supported by the synchronous config API.');
    }

    return readConfigSchemaResult(result);
  } catch (error: unknown) {
    if (isInvalidConfigError(error)) {
      throw error;
    }

    throw createInvalidConfigError(error);
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
  pendingReloadReason: ConfigReloadReason | undefined;
  reloading: boolean;
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

function applyReloadNow(
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

function applyReload(
  normalized: NormalizedLoadOptions,
  state: ReloaderState,
  listeners: ReadonlySet<ConfigReloadListener>,
  reason: ConfigReloadReason,
): ConfigDictionary {
  if (state.reloading) {
    state.pendingReloadReason = reason;
    return cloneConfigDictionary(state.current);
  }

  state.reloading = true;
  let activeReason = reason;

  try {
    let latest = applyReloadNow(normalized, state, listeners, activeReason);

    while (state.pendingReloadReason) {
      const pendingReason = state.pendingReloadReason;
      state.pendingReloadReason = undefined;
      activeReason = pendingReason;
      latest = applyReloadNow(normalized, state, listeners, pendingReason);
    }

    return latest;
  } catch (error: unknown) {
    markReloadFailure(error, activeReason);
    throw error;
  } finally {
    state.pendingReloadReason = undefined;
    state.reloading = false;
  }
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
      notifyReloadErrorListeners(errorListeners, error, getReloadFailureReason(error) ?? 'watch');
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

/**
 * Creates a stateful config reloader that mirrors `loadConfig(...)` semantics and optionally watches the env file.
 *
 * @param options Configuration loading options, including optional watch mode and a synchronous Standard Schema validator.
 * @returns A reloader that exposes the current snapshot, manual reload, subscriptions, and cleanup.
 * @throws {FluoError} When the initial config load or validation fails.
 *
 * @example
 * ```ts
 * const reloader = createConfigReloader({ envFile: '.env', watch: true });
 *
 * const subscription = reloader.subscribe((snapshot) => {
 *   console.log(snapshot.PORT);
 * });
 *
 * reloader.reload();
 * subscription.unsubscribe();
 * reloader.close();
 * ```
 */
export function createConfigReloader(options: ConfigLoadOptions): ConfigReloader {
  const normalized = normalizeLoadOptions(options);
  const state: ReloaderState = {
    current: resolveConfig(normalized),
    pendingReloadReason: undefined,
    reloading: false,
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

/**
 * Loads, merges, and validates one configuration snapshot without creating long-lived watcher state.
 *
 * Merge precedence stays aligned with the package README contract: `defaults` < env file < `processEnv` < `runtimeOverrides`.
 *
 * @param options Configuration loading options for source precedence, parsing, and synchronous schema validation.
 * @returns A detached normalized configuration dictionary for the current load.
 * @throws {FluoError} When validation throws or the config cannot be normalized.
 */
export function loadConfig(options: ConfigLoadOptions): ConfigDictionary {
  return cloneConfigDictionary(resolveConfig(normalizeLoadOptions(options)));
}
