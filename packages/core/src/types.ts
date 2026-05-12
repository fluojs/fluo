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

/**
 * Public dependency token accepted by Fluo containers, decorators, and module metadata.
 *
 * Class constructors act as self-describing tokens, while strings and symbols support
 * interface-like or cross-package registrations where no concrete class should leak.
 */
export type Token<T = unknown> = string | symbol | Constructor<T>;

/**
 * Deferred dependency-token wrapper accepted inside injection metadata.
 *
 * `@fluojs/di` creates this shape with `forwardRef(...)` so class decorators can
 * record tokens that are not available at decoration time without widening provider tokens.
 */
export interface ForwardRefToken<T = unknown> {
  __forwardRef__: true;
  forwardRef: () => Token<T>;
}

/**
 * Optional dependency-token wrapper accepted inside injection metadata.
 *
 * `@fluojs/di` creates this shape with `optional(...)` so required and optional
 * constructor dependencies can share the same class-level `@Inject(...)` list.
 */
export interface OptionalInjectToken<T = unknown> {
  __optional__: true;
  token: Token<T>;
}

/**
 * Constructor dependency entry accepted by `@Inject(...)` and provider inject arrays.
 *
 * Plain `Token` values register required dependencies, while `ForwardRefToken` and
 * `OptionalInjectToken` preserve documented `forwardRef(...)` and `optional(...)` wrappers.
 */
export type InjectionToken<T = unknown> = Token<T> | ForwardRefToken<T> | OptionalInjectToken<T>;

/**
 * Value that may be returned synchronously or wrapped in a `Promise`.
 *
 * This keeps factory helpers and lifecycle hooks flexible without forcing every caller to
 * treat the operation as asynchronous.
 */
export type MaybePromise<T> = T | Promise<T>;

/**
 * Factory configuration for module helpers that compute options during bootstrap.
 *
 * @typeParam T Resolved options shape returned to the module factory.
 */
export interface AsyncModuleOptions<T> {
  inject?: InjectionToken[];
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
}

/**
 * Metadata property name supported by Fluo's shared metadata stores.
 */
export type MetadataPropertyKey = string | symbol;

/**
 * Canonical request-data origins used by packages that describe how metadata values are bound.
 */
export type MetadataSource = 'path' | 'query' | 'header' | 'cookie' | 'body';
