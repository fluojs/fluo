import type { Mock } from 'vitest';

import type { MaybePromise, Token } from '@fluojs/core';
import type { ClassType, Container, ForwardRefFn, OptionalToken, Provider } from '@fluojs/di';
import type { BootstrapResult, BootstrapModuleOptions, ModuleType } from '@fluojs/runtime';
import type { Guard, Interceptor } from '@fluojs/http';
import type { RequestBuilder, TestPrincipal, TestRequest, TestRequestWithOptions, TestResponse } from './http.js';

/**
 * Bootstrap options accepted by `createTestingModule(...)`.
 */
export interface TestingModuleOptions extends BootstrapModuleOptions {
  rootModule: ModuleType;
}

/**
 * Optional request extras accepted by `TestApp.request(...)` overloads.
 */
export interface TestRequestOptions {
  principal?: TestPrincipal;
}

/**
 * Compiled testing-module facade that exposes sync/async resolution and request dispatch helpers.
 */
export interface TestingModuleRef extends BootstrapResult {
  has(token: Token): boolean;
  get<T>(token: Token<T>): T;
  resolve<T>(token: Token<T>): Promise<T>;
  resolveAll<T>(tokens: Token<T>[]): Promise<T[]>;
  dispatch(request: TestRequestWithOptions): Promise<TestResponse>;
}

/**
 * Fluent override builder returned by `overrideProvider(token)`.
 */
export interface OverrideProviderBuilder<T> {
  useValue(value: T): TestingModuleBuilder;
  useClass(cls: ClassType<T>): TestingModuleBuilder;
  useFactory(
    factory: (...args: unknown[]) => MaybePromise<T>,
    inject?: Array<Token | ForwardRefFn | OptionalToken>,
  ): TestingModuleBuilder;
  useExisting(token: Token<T>): TestingModuleBuilder;
}

/**
 * Builder contract for compiling an application module graph with targeted test overrides.
 */
export interface TestingModuleBuilder {
  compile(): Promise<TestingModuleRef>;
  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;
  overrideProvider<T>(token: Token<T>, provider: Provider<T>): this;
  overrideProvider<T>(token: Token<T>, value: T): this;
  overrideProviders(overrides: Array<[Token, unknown]>): this;
  overrideGuard(guard: Token<Guard>, fake?: Partial<Guard>): this;
  overrideInterceptor(interceptor: Token<Interceptor>, fake?: Partial<Interceptor>): this;
  overrideFilter(filter: Token<unknown>, fake?: unknown): this;
  overrideModule(module: ModuleType, replacement: ModuleType): this;
}

/**
 * Minimal testing bootstrap snapshot used by lower-level helpers.
 */
export interface TestingBootstrapResult {
  container: Container;
  modules: BootstrapResult['modules'];
  rootModule: ModuleType;
}

/**
 * Lightweight request-dispatch facade for integration-style tests.
 */
export interface TestApp {
  request(method: string, path: string, options?: TestRequestOptions): RequestBuilder;
  request(request: TestRequest): RequestBuilder;
  request(request: TestRequestWithOptions): RequestBuilder;
  dispatch(request: TestRequestWithOptions): Promise<TestResponse>;
  close(): Promise<void>;
}

/**
 * Shallow method-mocked version of a type where function properties become `vitest` mocks.
 */
export type DeepMocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R> & T[K]
    : T[K];
};
