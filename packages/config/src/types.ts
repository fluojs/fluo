import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Plain JSON-like object used as the normalized configuration snapshot shape.
 */
export type ConfigDictionary = Record<string, unknown>;

/**
 * Standard Schema v1-compatible config validator accepted by `@fluojs/config` loaders.
 *
 * @typeParam Input Raw merged config shape consumed by the schema validator.
 * @typeParam Output Normalized config shape produced by the schema validator.
 */
export type ConfigSchema<Input = unknown, Output extends ConfigDictionary = ConfigDictionary> = StandardSchemaV1<Input, Output>;

/**
 * Nested dot-path key helper.
 * Produces "a" | "a.b" | "a.b.c" keys from a Record type.
 */
export type DotPaths<T, Prefix extends string = ''> = T extends Record<string, unknown>
  ? {
      [K in keyof T & string]:
        | `${Prefix}${K}`
        | DotPaths<T[K], `${Prefix}${K}.`>;
    }[keyof T & string]
  : never;

/**
 * Resolves a dot-path key to its leaf value type.
 */
export type DotValue<T, K extends string> = K extends keyof T
  ? T[K]
  : K extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? DotValue<T[Head], Tail>
      : never
    : never;

/**
 * Module-level configuration options for loading and validating application config.
 */
export interface ConfigModuleOptions {
  envFile?: string;
  envFilePath?: string;
  processEnv?: NodeJS.ProcessEnv;
  schema?: ConfigSchema;
  defaults?: ConfigDictionary;
  /** Supply a custom file parser (e.g. for YAML or TOML). Receives raw file content,
   *  returns a flat key-value record. Defaults to dotenv parsing. */
  parse?: (content: string) => Record<string, string>;
  watch?: boolean;
  isGlobal?: boolean;
}

/**
 * Extended load options for one-off config loads and reloaders outside `ConfigModule.forRoot(...)`.
 */
export interface ConfigLoadOptions extends ConfigModuleOptions {
  cwd?: string;
  runtimeOverrides?: ConfigDictionary;
}

/**
 * Reason attached to config reload notifications.
 */
export type ConfigReloadReason = 'manual' | 'watch';

/**
 * Listener invoked after a config reload succeeds.
 */
export type ConfigReloadListener = (snapshot: ConfigDictionary, reason: ConfigReloadReason) => void;

/**
 * Listener invoked when a watched reload attempt fails.
 */
export type ConfigReloadErrorListener = (error: unknown, reason: ConfigReloadReason) => void;

/**
 * Disposable subscription handle returned from reloader listener registration.
 */
export interface ConfigReloadSubscription {
  unsubscribe(): void;
}

/**
 * Stateful config reloader contract returned by {@link createConfigReloader}.
 */
export interface ConfigReloader {
  current(): ConfigDictionary;
  reload(): ConfigDictionary;
  subscribe(listener: ConfigReloadListener): ConfigReloadSubscription;
  subscribeError(listener: ConfigReloadErrorListener): ConfigReloadSubscription;
  close(): void;
}
