import type { Constructor, MaybePromise, Token } from '@konekti/core';

export type Scope = 'singleton' | 'request' | 'transient';

export interface ClassType<T = unknown> extends Constructor<T> {
}

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassType<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
  resolverClass?: ClassType;
}

export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
  multi?: boolean;
}

export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: Token;
}

export type ForwardRefFn<T = unknown> = { __forwardRef__: true; forwardRef: () => Token<T> };

export type OptionalToken<T = unknown> = { __optional__: true; token: Token<T> };

export type Provider<T = unknown> =
  | ClassType<T>
  | ClassProvider<T>
  | FactoryProvider<T>
  | ValueProvider<T>
  | ExistingProvider<T>;

export interface Disposable {
  onDestroy(): MaybePromise<void>;
}

export interface RequestScopeContainer {
  resolve<T>(token: Token<T>): Promise<T>;
  dispose(): Promise<void>;
}

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

export function forwardRef<T = unknown>(fn: () => Token<T>): ForwardRefFn<T> {
  return { __forwardRef__: true, forwardRef: fn };
}

export function isForwardRef(value: unknown): value is ForwardRefFn {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && (value as ForwardRefFn).__forwardRef__ === true;
}

export function optional<T = unknown>(token: Token<T>): OptionalToken<T> {
  return { __optional__: true, token };
}

export function isOptionalToken(value: unknown): value is OptionalToken {
  return typeof value === 'object' && value !== null && '__optional__' in value && (value as OptionalToken).__optional__ === true;
}
