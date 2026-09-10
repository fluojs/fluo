import type { Constructor, ForwardRefToken, InjectionToken, MaybePromise, OptionalInjectToken, Token } from '@fluojs/core';

export type { ForwardRefToken, OptionalInjectToken } from '@fluojs/core';

/**
 * Lifetime policy understood by the DI container.
 */
export type Scope = 'singleton' | 'request' | 'transient';

/**
 * Constructable class token used by provider definitions.
 */
export type ClassType<T = unknown> = Constructor<T> & Function;

/**
 * Provider declaration that instantiates a class for a public token.
 */
export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassType<T>;
  inject?: InjectionToken[];
  scope?: Scope;
  multi?: boolean;
}

/**
 * Provider declaration that computes its value through a factory function.
 */
export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: InjectionToken[];
  scope?: Scope;
  multi?: boolean;
  /** Class metadata source used when the factory should inherit `@Scope(...)` metadata. */
  resolverClass?: ClassType;
}

/**
 * Provider declaration that binds a token to an already-created value.
 */
export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
  multi?: boolean;
}

/**
 * Provider declaration that aliases one token to another token's resolved value.
 */
export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: Token;
}

/**
 * Public provider shape accepted by container registration and override APIs.
 */
export type Provider<T = unknown> =
  | ClassType<T>
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>
  | ExistingProvider<T>;

/**
 * Disposable provider contract recognized by container teardown flows.
 */
export interface Disposable {
  onDestroy(): MaybePromise<void>;
}

/**
 * Minimal request-scope facade exposed to helpers that should not depend on the full `Container` implementation.
 */
export interface RequestScopeContainer {
  resolve<T>(token: Token<T>): Promise<T>;
  dispose(): Promise<void>;
}

/**
 * Compatibility-only provider record shape produced after the container validates public provider inputs.
 *
 * @remarks
 * This type remains root-exported for consumers that already reference the normalized DI record shape, but
 * application code should author providers with {@link Provider}, {@link ClassProvider}, {@link FactoryProvider},
 * {@link ValueProvider}, or {@link ExistingProvider}. The container owns construction of normalized records.
 */
export interface NormalizedProvider<T = unknown> {
  readonly inject: readonly InjectionToken[];
  readonly provide: Token<T>;
  readonly scope: Scope;
  readonly type: 'class' | 'factory' | 'value' | 'existing';
  readonly useClass?: ClassType<T>;
  readonly useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  readonly useValue?: T;
  readonly useExisting?: Token;
  readonly multi?: boolean;
}

/**
 * Creates deferred dependency tokens without evaluating their resolver.
 */
export class ForwardRef {
  private constructor() {}

  /**
   * Wraps a token resolver for declaration-order dependencies, not constructor cycles.
   *
   * @param fn Lazy token resolver, retained by identity.
   * @returns A frozen plain wrapper accepted by Inject and provider inject arrays.
   */
  static create<T = unknown>(fn: () => Token<T>): ForwardRefToken<T> {
    return Object.freeze<ForwardRefToken<T>>({ __forwardRef__: true, forwardRef: fn });
  }
}

/**
 * Returns whether a value is a deferred token wrapper.
 *
 * @param value Unknown dependency entry being inspected.
 * @returns `true` when the value carries the ForwardRef marker.
 */
export function isForwardRef(value: unknown): value is ForwardRefToken {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && (value as ForwardRefToken).__forwardRef__ === true;
}

/**
 * Creates optional dependency tokens independently of deferred token lookup.
 */
export class Optional {
  private constructor() {}

  /**
   * Marks one dependency as optional without resolving or replacing its token.
   *
   * @param token Token that may be absent in the current container hierarchy.
   * @returns A frozen plain wrapper; missing registrations resolve to undefined.
   */
  static create<T = unknown>(token: Token<T>): OptionalInjectToken<T> {
    return Object.freeze<OptionalInjectToken<T>>({ __optional__: true, token });
  }
}

/**
 * Returns whether a value is an optional-token wrapper.
 *
 * @param value Unknown dependency entry being inspected.
 * @returns `true` when the value wraps an optional token.
 */
export function isOptionalToken(value: unknown): value is OptionalInjectToken {
  return typeof value === 'object' && value !== null && '__optional__' in value && (value as OptionalInjectToken).__optional__ === true;
}
