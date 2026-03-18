import type { Token } from '@konekti/core';
import type { ClassType, Provider } from '@konekti/di';
import type { BootstrapResult } from '@konekti/runtime';
import { bootstrapModule } from '@konekti/runtime';

import { createDispatcher, createHandlerMapping } from '@konekti/http';
import type { HandlerSource } from '@konekti/http';
import { createTestRequestContextMiddleware, makeRequest, type TestRequestWithOptions } from './http.js';
import type { TestingModuleBuilder, TestingModuleOptions, TestingModuleRef } from './types.js';

function createHandlerSources(bootstrappedModules: BootstrapResult['modules']): HandlerSource[] {
  return bootstrappedModules.flatMap((compiledModule) =>
    (compiledModule.definition.controllers ?? []).map((controllerToken) => ({
      controllerToken,
      moduleMiddleware: compiledModule.definition.middleware ?? [],
      moduleType: compiledModule.type,
    })),
  );
}

function createTestingDispatcher(bootstrapped: BootstrapResult): ReturnType<typeof createDispatcher> {
  const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules));

  return createDispatcher({
    appMiddleware: [createTestRequestContextMiddleware()],
    handlerMapping,
    rootContainer: bootstrapped.container,
  });
}

function isProviderDescriptor<T>(value: Provider<T> | T): value is Provider<T> {
  return typeof value === 'object' && value !== null && ('useClass' in value || 'useFactory' in value || 'useValue' in value);
}

function isClassConstructor<T>(value: Provider<T> | T): value is ClassType<T> {
  return typeof value === 'function';
}

function normalizeOverride<T>(token: Token<T>, value: Provider<T> | T): Provider<T> {
  if (isProviderDescriptor(value)) {
    return { ...value, provide: token } as Provider<T>;
  }

  if (isClassConstructor(value)) {
    return { provide: token, useClass: value };
  }

  return { provide: token, useValue: value };
}

class DefaultTestingModuleBuilder implements TestingModuleBuilder {
  private readonly overrides: Provider[] = [];

  constructor(private readonly options: TestingModuleOptions) {}

  overrideProvider<T>(token: Token<T>, value: Provider<T> | T): this {
    this.overrides.push(normalizeOverride(token, value));
    return this;
  }

  async compile(): Promise<TestingModuleRef> {
    const bootstrapped = bootstrapModule(this.options.rootModule, {
      providers: this.options.providers,
    });

    if (this.overrides.length > 0) {
      bootstrapped.container.register(...this.overrides);
    }

    const dispatcher = createTestingDispatcher(bootstrapped);

    return {
      ...bootstrapped,
      has: (token) => bootstrapped.container.has(token),
      resolve: (token) => bootstrapped.container.resolve(token),
      dispatch: (request: TestRequestWithOptions) => makeRequest(dispatcher, request),
    };
  }
}

export function createTestingModule(options: TestingModuleOptions): TestingModuleBuilder {
  return new DefaultTestingModuleBuilder(options);
}
