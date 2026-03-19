import type { Mock } from 'vitest';

import type { Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import type { BootstrapResult, BootstrapModuleOptions, ModuleType } from '@konekti/runtime';
import type { Guard, Interceptor } from '@konekti/http';
import type { RequestBuilder, TestPrincipal, TestRequest, TestRequestWithOptions, TestResponse } from './http.js';

export interface TestingModuleOptions extends BootstrapModuleOptions {
  rootModule: ModuleType;
}

export interface TestRequestOptions {
  principal?: TestPrincipal;
}

export interface TestingModuleRef extends BootstrapResult {
  has(token: Token): boolean;
  resolve<T>(token: Token<T>): Promise<T>;
  dispatch(request: TestRequestWithOptions): Promise<TestResponse>;
}

export interface TestingModuleBuilder {
  compile(): Promise<TestingModuleRef>;
  overrideProvider<T>(token: Token<T>, provider: Provider<T>): this;
  overrideProvider<T>(token: Token<T>, value: T): this;
  overrideGuard(guard: Token<Guard>, fake?: Partial<Guard>): this;
  overrideInterceptor(interceptor: Token<Interceptor>, fake?: Partial<Interceptor>): this;
  overrideFilter(filter: Token<unknown>, fake?: unknown): this;
  overrideModule(module: ModuleType, replacement: ModuleType): this;
}

export interface TestingBootstrapResult {
  container: Container;
  modules: BootstrapResult['modules'];
  rootModule: ModuleType;
}

export interface TestApp {
  request(method: string, path: string, options?: TestRequestOptions): RequestBuilder;
  request(request: TestRequest): RequestBuilder;
  request(request: TestRequestWithOptions): RequestBuilder;
  dispatch(request: TestRequestWithOptions): Promise<TestResponse>;
  close(): Promise<void>;
}

export type DeepMocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R> & T[K]
    : T[K];
};
