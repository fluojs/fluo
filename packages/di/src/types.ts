import type { Constructor, MaybePromise, Token } from '@konekti/core';

export type Scope = 'singleton' | 'request' | 'transient';

export interface ClassType<T = unknown> extends Constructor<T> {
}

export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassType<T>;
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

export type Provider<T = unknown> = ClassType<T> | ClassProvider<T> | FactoryProvider<T> | ValueProvider<T>;

export interface RequestScopeContainer {
  resolve<T>(token: Token<T>): Promise<T>;
}

export interface NormalizedProvider<T = unknown> {
  inject: Token[];
  provide: Token<T>;
  scope: Scope;
  type: 'class' | 'factory' | 'value';
  useClass?: ClassType<T>;
  useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  useValue?: T;
}
