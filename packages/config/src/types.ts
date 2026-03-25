/**
 * @deprecated Use `envFile` option instead. Mode-based env file selection is removed.
 */
export type ConfigMode = 'dev' | 'prod' | 'test';

export type ConfigDictionary = Record<string, unknown>;

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

export interface ConfigModuleOptions {
  envFile?: string;
  validate?: (raw: ConfigDictionary) => ConfigDictionary;
  defaults?: ConfigDictionary;
  /** Supply a custom file parser (e.g. for YAML or TOML). Receives raw file content,
   *  returns a flat key-value record. Defaults to dotenv parsing. */
  parse?: (content: string) => Record<string, string>;
  watch?: boolean;
}

export interface ConfigLoadOptions extends ConfigModuleOptions {
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
  runtimeOverrides?: ConfigDictionary;
}

export type ConfigReloadReason = 'manual' | 'watch';

export type ConfigReloadListener = (snapshot: ConfigDictionary, reason: ConfigReloadReason) => void;

export type ConfigReloadErrorListener = (error: unknown, reason: ConfigReloadReason) => void;

export interface ConfigReloadSubscription {
  unsubscribe(): void;
}

export interface ConfigReloader {
  current(): ConfigDictionary;
  reload(): ConfigDictionary;
  subscribe(listener: ConfigReloadListener): ConfigReloadSubscription;
  subscribeError(listener: ConfigReloadErrorListener): ConfigReloadSubscription;
  close(): void;
}
