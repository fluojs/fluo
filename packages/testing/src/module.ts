import type { MaybePromise, Token } from '@konekti/core';
import { getModuleMetadata } from '@konekti/core';
import {
  isForwardRef,
  isOptionalToken,
  type ClassType,
  type ForwardRefFn,
  type NormalizedProvider,
  type OptionalToken,
  type Provider,
} from '@konekti/di';
import type { BootstrapResult, ModuleDefinition, ModuleType } from '@konekti/runtime';
import { bootstrapModule, defineModule } from '@konekti/runtime';

import { createDispatcher, createHandlerMapping } from '@konekti/http';
import type { Guard, HandlerSource, Interceptor } from '@konekti/http';
import { createTestRequestContextMiddleware, makeRequest, type TestRequestWithOptions } from './http.js';
import type { OverrideProviderBuilder, TestingModuleBuilder, TestingModuleOptions, TestingModuleRef } from './types.js';

export function extractModuleProviders(moduleType: ModuleType): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    return [];
  }

  return metadata.providers as Provider[];
}

export function extractModuleControllers(moduleType: ModuleType): ClassType[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.controllers)) {
    return [];
  }

  return metadata.controllers as ClassType[];
}

export function extractModuleImports(moduleType: ModuleType): ModuleType[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.imports)) {
    return [];
  }

  return metadata.imports as ModuleType[];
}

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

function isProviderDescriptor<T>(value: Provider<T> | T): value is Exclude<Provider<T>, ClassType<T>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    ('useClass' in value || 'useFactory' in value || 'useValue' in value || 'useExisting' in value)
  );
}

function isClassConstructor<T>(value: Provider<T> | T): value is ClassType<T> {
  if (typeof value !== 'function') {
    return false;
  }

  const source = Function.prototype.toString.call(value);
  return source.startsWith('class ');
}

function normalizeOverride<T>(token: Token<T>, value: Provider<T> | T): Provider<T> {
  if (isProviderDescriptor(value)) {
    if (value.provide !== token) {
      throw new Error(
        `overrideProvider token mismatch: expected ${String(token)} but received provider for ${String(value.provide)}.`,
      );
    }

    return { ...value, provide: token } as Provider<T>;
  }

  if (isClassConstructor(value)) {
    return { provide: token, useClass: value };
  }

  return { provide: token, useValue: value };
}

interface ContainerIntrospection {
  parent?: ContainerIntrospection;
  registrations: Map<Token, NormalizedProvider>;
  multiRegistrations: Map<Token, NormalizedProvider[]>;
  requestScopeEnabled?: boolean;
}

function isContainerIntrospection(value: unknown): value is ContainerIntrospection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    multiRegistrations?: unknown;
    parent?: unknown;
    registrations?: unknown;
    requestScopeEnabled?: unknown;
  };

  const parentValid = candidate.parent === undefined || isContainerIntrospection(candidate.parent);
  const requestScopeValid = candidate.requestScopeEnabled === undefined || typeof candidate.requestScopeEnabled === 'boolean';

  return candidate.registrations instanceof Map && candidate.multiRegistrations instanceof Map && parentValid && requestScopeValid;
}

function toContainerIntrospection(container: BootstrapResult['container']): ContainerIntrospection {
  if (!isContainerIntrospection(container)) {
    throw new Error('Testing container introspection is unavailable for the current container implementation.');
  }

  return container;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

interface SyncResolverState {
  introspection: ContainerIntrospection;
  resolutionChain: Set<Token>;
  singletonCache: Map<Token, unknown>;
}

function collectMultiProviders(target: ContainerIntrospection, token: Token): NormalizedProvider[] {
  const fromParent = target.parent ? collectMultiProviders(target.parent, token) : [];
  const local = target.multiRegistrations.get(token) ?? [];
  return [...fromParent, ...local];
}

function lookupProvider(target: ContainerIntrospection, token: Token): NormalizedProvider | undefined {
  const local = target.registrations.get(token);

  if (local) {
    return local;
  }

  return target.parent ? lookupProvider(target.parent, token) : undefined;
}

function hasToken(state: SyncResolverState, token: Token): boolean {
  return lookupProvider(state.introspection, token) !== undefined || collectMultiProviders(state.introspection, token).length > 0;
}

function resolveSyncDependency(entry: Token | ForwardRefFn | OptionalToken, state: SyncResolverState): unknown {
  if (isOptionalToken(entry)) {
    if (!hasToken(state, entry.token)) {
      return undefined;
    }

    return resolveSyncToken(entry.token, state);
  }

  if (isForwardRef(entry)) {
    return resolveSyncToken(entry.forwardRef(), state);
  }

  return resolveSyncToken(entry as Token, state);
}

function instantiateSyncProvider(provider: NormalizedProvider, state: SyncResolverState): unknown {
  switch (provider.type) {
    case 'value': {
      return provider.useValue;
    }
    case 'existing': {
      if (!provider.useExisting) {
        throw new Error('Existing provider is missing useExisting token.');
      }

      return resolveSyncToken(provider.useExisting, state);
    }
    case 'factory': {
      if (!provider.useFactory) {
        throw new Error('Factory provider is missing useFactory.');
      }

      const deps = provider.inject.map((entry) => resolveSyncDependency(entry, state));
      const value = provider.useFactory(...deps) as MaybePromise<unknown>;

      if (isPromiseLike(value)) {
        throw new Error(
          `Token ${String(provider.provide)} requires async resolution. Use resolve() instead of get() for async providers.`,
        );
      }

      return value;
    }
    case 'class': {
      if (!provider.useClass) {
        throw new Error('Class provider is missing useClass.');
      }

      const deps = provider.inject.map((entry) => resolveSyncDependency(entry, state));
      return new provider.useClass(...deps);
    }
    default: {
      throw new Error('Unknown provider type.');
    }
  }
}

function resolveSyncProvider(provider: NormalizedProvider, state: SyncResolverState): unknown {
  if (provider.scope === 'request' && !state.introspection.requestScopeEnabled) {
    throw new Error(`Request-scoped provider ${String(provider.provide)} cannot be resolved outside request scope.`);
  }

  if (provider.scope === 'transient') {
    return instantiateSyncProvider(provider, state);
  }

  if (state.singletonCache.has(provider.provide)) {
    return state.singletonCache.get(provider.provide);
  }

  const instance = instantiateSyncProvider(provider, state);
  state.singletonCache.set(provider.provide, instance);
  return instance;
}

function resolveSyncToken(token: Token, state: SyncResolverState): unknown {
  if (state.resolutionChain.has(token)) {
    throw new Error(`Circular dependency detected while resolving token ${String(token)} via get().`);
  }

  state.resolutionChain.add(token);

  try {
    const multiProviders = collectMultiProviders(state.introspection, token);

    if (multiProviders.length > 0) {
      return multiProviders.map((provider) => instantiateSyncProvider(provider, state));
    }

    const provider = lookupProvider(state.introspection, token);

    if (!provider) {
      throw new Error(`No provider registered for token ${String(token)}.`);
    }

    return resolveSyncProvider(provider, state);
  } finally {
    state.resolutionChain.delete(token);
  }
}

function createSyncResolver(
  container: BootstrapResult['container'],
): <T>(token: Token<T>) => T {
  const state: SyncResolverState = {
    introspection: toContainerIntrospection(container),
    resolutionChain: new Set<Token>(),
    singletonCache: new Map<Token, unknown>(),
  };

  return <T>(token: Token<T>): T => resolveSyncToken(token, state) as T;
}

class DefaultOverrideProviderBuilder<T> implements OverrideProviderBuilder<T> {
  constructor(
    private readonly builder: DefaultTestingModuleBuilder,
    private readonly token: Token<T>,
  ) {}

  useValue(value: T): TestingModuleBuilder {
    this.builder.addOverride(normalizeOverride(this.token, value));
    return this.builder;
  }

  useClass(cls: ClassType<T>): TestingModuleBuilder {
    this.builder.addOverride({ provide: this.token, useClass: cls });
    return this.builder;
  }

  useFactory(
    factory: (...args: unknown[]) => MaybePromise<T>,
    inject?: Array<Token | ForwardRefFn | OptionalToken>,
  ): TestingModuleBuilder {
    this.builder.addOverride({ provide: this.token, useFactory: factory, inject });
    return this.builder;
  }

  useExisting(token: Token<T>): TestingModuleBuilder {
    this.builder.addOverride({ provide: this.token, useExisting: token });
    return this.builder;
  }
}

class DefaultTestingModuleBuilder implements TestingModuleBuilder {
  private readonly overrides: Provider[] = [];
  private readonly moduleReplacements = new Map<ModuleType, ModuleType>();

  constructor(private readonly options: TestingModuleOptions) {}

  addOverride(provider: Provider): void {
    this.overrides.push(provider);
  }

  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;
  overrideProvider<T>(token: Token<T>, provider: Provider<T>): this;
  overrideProvider<T>(token: Token<T>, value: T): this;
  overrideProvider<T>(token: Token<T>, value?: Provider<T> | T): this | OverrideProviderBuilder<T> {
    if (value === undefined) {
      return new DefaultOverrideProviderBuilder(this, token);
    }

    this.overrides.push(normalizeOverride(token, value));
    return this;
  }

  overrideProviders(overrides: Array<[Token, unknown]>): this {
    for (const [token, value] of overrides) {
      this.overrideProvider(token, value);
    }

    return this;
  }

  overrideGuard(guard: Token<Guard>, fake: Partial<Guard> = {}): this {
    const passthrough: Guard = { canActivate: () => true, ...fake };
    this.overrides.push({ provide: guard as Token<Guard>, useValue: passthrough });
    return this;
  }

  overrideInterceptor(interceptor: Token<Interceptor>, fake: Partial<Interceptor> = {}): this {
    const passthrough: Interceptor = { intercept: (_ctx, next) => next.handle(), ...fake };
    this.overrides.push({ provide: interceptor as Token<Interceptor>, useValue: passthrough });
    return this;
  }

  overrideFilter(filter: Token<unknown>, fake: unknown = {}): this {
    this.overrides.push({ provide: filter, useValue: fake });
    return this;
  }

  overrideModule(module: ModuleType, replacement: ModuleType): this {
    this.moduleReplacements.set(module, replacement);
    return this;
  }

  async compile(): Promise<TestingModuleRef> {
    const bootstrapped = this.bootstrapTestingModule();

    return this.createTestingModuleRef(bootstrapped);
  }

  private bootstrapTestingModule(): BootstrapResult {
    const rootModule = this._applyModuleReplacements(this.options.rootModule);

    const bootstrapped = bootstrapModule(rootModule, {
      providers: this.options.providers,
    });

    if (this.overrides.length > 0) {
      bootstrapped.container.override(...this.overrides);
    }

    return bootstrapped;
  }

  private createTestingModuleRef(bootstrapped: BootstrapResult): TestingModuleRef {
    const dispatcher = createTestingDispatcher(bootstrapped);
    const getSync = createSyncResolver(bootstrapped.container);

    return {
      ...bootstrapped,
      has: (token) => bootstrapped.container.has(token),
      get: (token) => getSync(token),
      resolve: (token) => bootstrapped.container.resolve(token),
      resolveAll: async <T>(tokens: Token<T>[]): Promise<T[]> => {
        const results: T[] = [];
        const errors: Array<{ token: Token; error: unknown }> = [];

        for (const token of tokens) {
          try {
            results.push(await bootstrapped.container.resolve<T>(token));
          } catch (error) {
            errors.push({ token, error });
          }
        }

        if (errors.length > 0) {
          const summary = errors
            .map(({ token, error }) => `  - ${String(token)}: ${error instanceof Error ? error.message : String(error)}`)
            .join('\n');

          throw new Error(`Failed to resolve ${errors.length} of ${tokens.length} tokens:\n${summary}`);
        }

        return results;
      },
      dispatch: (request: TestRequestWithOptions) => makeRequest(dispatcher, request),
    };
  }

  private _applyModuleReplacements(module: ModuleType): ModuleType {
    if (this.moduleReplacements.size === 0) {
      return module;
    }

    const replacement = this.moduleReplacements.get(module);
    if (replacement) {
      return replacement;
    }

    const metadata = getModuleMetadata(module);
    if (!metadata?.imports || metadata.imports.length === 0) {
      return module;
    }

    const rewrittenImports = this.rewriteModuleImports(metadata.imports as ModuleType[]);
    const hasChange = rewrittenImports.some(
      (imp, i) => imp !== (metadata.imports as ModuleType[])[i],
    );

    if (!hasChange) {
      return module;
    }

    class PatchedModule {}
    const patchedModule: ModuleType = PatchedModule;

    defineModule(patchedModule, {
      ...(metadata as ModuleDefinition),
      imports: rewrittenImports,
    });

    return patchedModule;
  }

  private rewriteModuleImports(imports: ModuleType[]): ModuleType[] {
    return imports.map((moduleImport) => this._applyModuleReplacements(moduleImport));
  }
}

export function createTestingModule(options: TestingModuleOptions): TestingModuleBuilder {
  return new DefaultTestingModuleBuilder(options);
}

export const Test = {
  createTestingModule,
};
