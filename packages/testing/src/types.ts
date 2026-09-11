import type { MaybePromise, Token } from '@fluojs/core';
import type { ClassType, Container, ForwardRefToken, OptionalInjectToken } from '@fluojs/di';
import type { BootstrapApplicationOptions, BootstrapModuleOptions, BootstrapResult, ModuleType } from '@fluojs/runtime';
import type { RequestBuilder, TestPrincipal, TestRequest, TestRequestWithOptions } from './http.js';

/**
 * Bootstrap options accepted by `Test.createTestingModule(...)`.
 */
export interface TestingModuleOptions extends BootstrapModuleOptions {
  rootModule: ModuleType;
}

/**
 * Bootstrap options accepted by `Test.createApp(...)`.
 */
export interface TestingApplicationOptions extends BootstrapApplicationOptions {
  rootModule: ModuleType;
}

/**
 * Optional request extras accepted by `TestApp.request(...)` overloads.
 */
export interface TestRequestOptions {
  cookies?: TestRequest['cookies'];
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
}

/**
 * Fluent override builder returned by `overrideProvider(token)`.
 */
export interface OverrideProviderBuilder<T> {
  useValue(value: T): TestingModuleBuilder;
  useClass(cls: ClassType<T>): TestingModuleBuilder;
  useFactory(
    factory: (...args: unknown[]) => MaybePromise<T>,
    inject?: Array<Token | ForwardRefToken | OptionalInjectToken>,
  ): TestingModuleBuilder;
  useExisting(token: Token<T>): TestingModuleBuilder;
}

/**
 * Builder contract for compiling an application module graph with targeted test overrides.
 */
export interface TestingModuleBuilder {
  compile(): Promise<TestingModuleRef>;
  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;
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
  close(): Promise<void>;
}

/**
 * Result entry recorded by a Vitest-compatible testing mock.
 */
export type TestingMockResult<Return> =
  | { type: 'return'; value: Return }
  | { type: 'throw'; value: unknown }
  | { type: 'incomplete'; value: undefined };

/**
 * Settled async result entry recorded by a Vitest-compatible testing mock.
 */
export type TestingMockSettledResult<Return> =
  | { type: 'fulfilled'; value: Awaited<Return> }
  | { type: 'rejected'; value: unknown };

/**
 * Context snapshot exposed from a Vitest-compatible testing mock.
 */
export interface TestingMockContext<Args extends unknown[] = unknown[], Return = unknown> {
  calls: Args[];
  instances: Return[];
  contexts: unknown[];
  invocationCallOrder: number[];
  results: Array<TestingMockResult<Return>>;
  settledResults: Array<TestingMockSettledResult<Return>>;
  lastCall: Args | undefined;
}

/**
 * Vitest `Mock<T>`-compatible function shape used to preserve root `ShallowMocked<T>` type imports
 * without importing Vitest peer declarations through non-mock entrypoints.
 */
export interface TestingMockFunction<Args extends unknown[] = unknown[], Return = unknown> {
  new (...args: Args): Return;
  (...args: Args): Return;
  [Symbol.dispose](): void;
  mock: TestingMockContext<Args, Return>;
  getMockName(): string;
  getMockImplementation(): ((...args: Args) => Return) | undefined;
  mockClear(): this;
  mockName(name: string): this;
  mockReset(): this;
  mockRestore(): void;
  mockImplementation(fn: (...args: Args) => Return): this;
  mockImplementationOnce(fn: (...args: Args) => Return): this;
  withImplementation(fn: (...args: Args) => Return, callback: () => Promise<unknown>): Promise<this>;
  withImplementation(fn: (...args: Args) => Return, callback: () => unknown): this;
  mockReturnThis(): this;
  mockReturnValue(value: Return): this;
  mockReturnValueOnce(value: Return): this;
  mockThrow(value: unknown): this;
  mockThrowOnce(value: unknown): this;
  mockResolvedValue(value: Awaited<Return>): this;
  mockResolvedValueOnce(value: Awaited<Return>): this;
  mockRejectedValue(error: unknown): this;
  mockRejectedValueOnce(error: unknown): this;
}

/**
 * Shallow method-mocked version of a type where function properties become mock functions.
 * Nested objects remain unchanged. Migrate `DeepMocked<T>` and `MockedMethods<T>`
 * imports to `ShallowMocked<T>`; this type never represented recursive mocking.
 */
export type ShallowMocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? TestingMockFunction<A, R> & T[K] : T[K];
};
