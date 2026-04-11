import type { Constructor, MaybePromise, Token } from '@fluojs/core';

/**
 * Lifetime policy understood by the DI container.
 */
export type Scope = 'singleton' | 'request' | 'transient';

/**
 * Namespace helpers for the public DI scope literals.
 */
export namespace Scope {
  /**
   * Default lifetime used when a provider omits an explicit scope.
   */
  export const DEFAULT: Scope = 'singleton';

  /**
   * Scope literal for providers that should be recreated per request container.
   */
  export const REQUEST: Scope = 'request';

  /**
   * Scope literal for providers that should be recreated on every resolution.
   */
  export const TRANSIENT: Scope = 'transient';
}

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
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
}

/**
 * Provider declaration that computes its value through a factory function.
 */
export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
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
 * Deferred token resolver used to break declaration-time cycles between providers.
 */
export type ForwardRefFn<T = unknown> = { __forwardRef__: true; forwardRef: () => Token<T> };

/**
 * Wrapper token that marks a dependency as optional during resolution.
 */
export type OptionalToken<T = unknown> = { __optional__: true; token: Token<T> };

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
 * Internal normalized provider representation used after the container validates public provider inputs.
 */
export interface NormalizedProvider<T = unknown> {
  inject: Array<Token | ForwardRefFn | OptionalToken>;
  provide: Token<T>;
  scope: Scope;
  type: 'class' | 'factory' | 'value' | 'existing';
  useClass?: ClassType<T>;
  useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  useValue?: T;
  useExisting?: Token;
  multi?: boolean;
}

/**
 * Wraps a token factory so DI metadata can defer token lookup until resolution time.
 *
 * @param fn Lazy token resolver used when the dependency is eventually resolved.
 * @returns A marker object understood by container normalization and resolution helpers.
 *
 * @example
 * ```ts
 * @Inject(forwardRef(() => AuthService))
 * class UsersService {
 *   constructor(private readonly auth: AuthService) {}
 * }
 * ```
 */
export function forwardRef<T = unknown>(fn: () => Token<T>): ForwardRefFn<T> {
  return { __forwardRef__: true, forwardRef: fn };
}

/**
 * Returns whether a value is a `forwardRef(...)` token wrapper.
 *
 * @param value Unknown dependency entry being inspected.
 * @returns `true` when the value was produced by {@link forwardRef}.
 */
export function isForwardRef(value: unknown): value is ForwardRefFn {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && (value as ForwardRefFn).__forwardRef__ === true;
}

/**
 * Marks a dependency token as optional so missing registrations resolve to `undefined` instead of throwing.
 *
 * @param token Token that may be absent in the current container hierarchy.
 * @returns An optional-token wrapper understood by container resolution.
 */
export function optional<T = unknown>(token: Token<T>): OptionalToken<T> {
  return { __optional__: true, token };
}

/**
 * Returns whether a value is an optional-token wrapper created by {@link optional}.
 *
 * @param value Unknown dependency entry being inspected.
 * @returns `true` when the value wraps an optional token.
 */
export function isOptionalToken(value: unknown): value is OptionalToken {
  return typeof value === 'object' && value !== null && '__optional__' in value && (value as OptionalToken).__optional__ === true;
}
