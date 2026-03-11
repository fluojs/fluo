import type { Constructor, MaybePromise, Token } from '@konekti/core';

export type Scope = 'singleton' | 'request';

export interface InjectableClass<T = unknown> extends Constructor<T> {
  inject?: Token[];
}

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: InjectableClass<T>;
  inject?: Token[];
  scope?: Scope;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: Token[];
  scope?: Scope;
}

export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
}

export type Provider<T = unknown> = InjectableClass<T> | ClassProvider<T> | FactoryProvider<T> | ValueProvider<T>;

export interface RequestScopeContainer {
  resolve<T>(token: Token<T>): Promise<T>;
}

export interface NormalizedProvider<T = unknown> {
  inject: Token[];
  provide: Token<T>;
  scope: Scope;
  type: 'class' | 'factory' | 'value';
  useClass?: InjectableClass<T>;
  useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  useValue?: T;
}
