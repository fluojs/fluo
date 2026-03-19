/**
 * A constructable type that yields `T`.
 *
 * The `any[]` parameter list is intentional — this type models "some class that
 * produces T" for DI token resolution, not a safely-callable constructor
 * signature. Using `unknown[]` would break assignability for any class with
 * typed constructor parameters (variance rules make `[string]` incompatible
 * with `unknown[]` in `new` signatures). Every major DI framework (NestJS,
 * Angular, tsyringe, inversify) uses the same pattern for the same reason.
 */
export type Constructor<T = unknown> = new (...args: any[]) => T;

export type Token<T = unknown> = string | symbol | Constructor<T>;

export type MaybePromise<T> = T | Promise<T>;

export interface AsyncModuleOptions<T> {
  inject?: Token[];
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
}

export type MetadataPropertyKey = string | symbol;

export type MetadataSource = 'path' | 'query' | 'header' | 'cookie' | 'body';
