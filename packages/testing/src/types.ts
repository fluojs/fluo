import type { Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import type { BootstrapResult, BootstrapModuleOptions, ModuleType } from '@konekti/runtime';
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
