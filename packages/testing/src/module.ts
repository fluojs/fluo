import { getModuleMetadata, type MaybePromise, type Token } from '@fluojs/core';
import {
  isForwardRef,
  isOptionalToken,
  type ClassType,
  type ForwardRefFn,
  type NormalizedProvider,
  type OptionalToken,
  type Provider,
  Scope,
} from '@fluojs/di';
import type { BootstrapResult, ModuleDefinition, ModuleType } from '@fluojs/runtime';
import { bootstrapModule, defineModule } from '@fluojs/runtime';

import { createDispatcher, createHandlerMapping } from '@fluojs/http';
import type { Guard, HandlerSource, Interceptor } from '@fluojs/http';
import { createTestRequestContextMiddleware, makeRequest, type TestRequestWithOptions } from './http.js';
import type { OverrideProviderBuilder, TestingModuleBuilder, TestingModuleOptions, TestingModuleRef } from './types.js';

/**
 * Returns providers declared on a module metadata definition.
 *
 * @param moduleType Module type whose `providers` metadata should be inspected.
 * @returns The declared provider list, or an empty array when the module has none.
 */
export function extractModuleProviders(moduleType: ModuleType): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    return [];
  }

  return metadata.providers as Provider[];
}

/**
 * Returns controllers declared on a module metadata definition.
 *
 * @param moduleType Module type whose `controllers` metadata should be inspected.
 * @returns The declared controller list, or an empty array when the module has none.
 */
export function extractModuleControllers(moduleType: ModuleType): ClassType[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.controllers)) {
    return [];
  }

  return metadata.controllers as ClassType[];
}

/**
 * Returns imported modules declared on a module metadata definition.
 *
 * @param moduleType Module type whose `imports` metadata should be inspected.
 * @returns The declared import list, or an empty array when the module has none.
 */
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
  multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>;
  requestScopeEnabled?: boolean;
  singletonCache: Map<Token, Promise<unknown>>;
}

function isContainerIntrospection(value: unknown): value is ContainerIntrospection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    multiRegistrations?: unknown;
    multiSingletonCache?: unknown;
    parent?: unknown;
    registrations?: unknown;
    requestScopeEnabled?: unknown;
    singletonCache?: unknown;
  };

  const parentValid = candidate.parent === undefined || isContainerIntrospection(candidate.parent);
  const requestScopeValid = candidate.requestScopeEnabled === undefined || typeof candidate.requestScopeEnabled === 'boolean';

  return (
    candidate.registrations instanceof Map &&
    candidate.multiRegistrations instanceof Map &&
    candidate.multiSingletonCache instanceof Map &&
    candidate.singletonCache instanceof Map &&
    parentValid &&
    requestScopeValid
  );
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
  factoryResolutionKinds: WeakMap<NormalizedProvider, 'async' | 'sync'>;
  introspection: ContainerIntrospection;
  multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>;
  resolutionChain: Set<Token>;
  singletonCache: Map<Token, Promise<unknown>>;
  syncMultiSingletonValues: Map<NormalizedProvider, unknown>;
  syncSingletonValues: Map<Token, unknown>;
}

interface SyncResolver {
  get<T>(token: Token<T>): T;
  syncFromContainer(): Promise<void>;
}

type LifecycleHookName = 'onModuleInit' | 'onApplicationBootstrap';

function hasLifecycleHook(value: unknown, hookName: LifecycleHookName): value is Record<LifecycleHookName, () => MaybePromise<void>> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as Record<LifecycleHookName, unknown>)[hookName] === 'function'
  );
}

function hasAnyBootstrapLifecycleHook(value: unknown): boolean {
  return hasLifecycleHook(value, 'onModuleInit') || hasLifecycleHook(value, 'onApplicationBootstrap');
}

function providerToken(provider: Provider): Token {
  return isProviderDescriptor(provider) ? provider.provide : provider;
}

function isValueProvider(provider: Provider): provider is Extract<Provider, { useValue: unknown }> {
  return isProviderDescriptor(provider) && 'useValue' in provider;
}

function isLifecycleValueProvider(provider: Provider): provider is Extract<Provider, { useValue: unknown }> {
  return isValueProvider(provider) && hasAnyBootstrapLifecycleHook(provider.useValue);
}

function isDirectSingletonLifecycleProvider(provider: Provider): boolean {
  if (isLifecycleValueProvider(provider)) {
    return true;
  }

  if (isProviderDescriptor(provider)) {
    return 'useClass' in provider ? (provider.scope ?? Scope.DEFAULT) === Scope.DEFAULT : false;
  }

  return isClassConstructor(provider);
}

async function resolveTestingLifecycleInstances(bootstrapped: BootstrapResult): Promise<unknown[]> {
  const lifecycleProviders = [
    ...bootstrapped.effectiveProviders.runtimeProviders,
    ...bootstrapped.effectiveProviders.moduleProviders,
  ];
  const instances: unknown[] = [];
  const seen = new Set<Token>();

  for (const provider of lifecycleProviders) {
    const token = providerToken(provider);

    if (seen.has(token)) {
      continue;
    }

    if (isLifecycleValueProvider(provider)) {
      seen.add(token);
      instances.push(provider.useValue);
      continue;
    }

    if (!isDirectSingletonLifecycleProvider(provider)) {
      continue;
    }

    seen.add(token);

    try {
      instances.push(await bootstrapped.container.resolve(token));
    } catch (error) {
      if (error instanceof Error && error.message.includes('Request-scoped provider')) {
        continue;
      }

      throw error;
    }
  }

  return instances;
}

async function runTestingBootstrapLifecycle(bootstrapped: BootstrapResult): Promise<void> {
  const instances = await resolveTestingLifecycleInstances(bootstrapped);

  for (const instance of instances) {
    if (hasLifecycleHook(instance, 'onModuleInit')) {
      await instance.onModuleInit();
    }
  }

  for (const instance of instances) {
    if (hasLifecycleHook(instance, 'onApplicationBootstrap')) {
      await instance.onApplicationBootstrap();
    }
  }
}

function rootContainerIntrospection(target: ContainerIntrospection): ContainerIntrospection {
  return target.parent ? rootContainerIntrospection(target.parent) : target;
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

function dependencyToken(entry: Token | ForwardRefFn | OptionalToken): Token {
  if (isOptionalToken(entry)) {
    return entry.token;
  }

  if (isForwardRef(entry)) {
    return entry.forwardRef();
  }

  return entry as Token;
}

function trackFactoryResolutionKind(
  provider: NormalizedProvider,
  factoryResolutionKinds: WeakMap<NormalizedProvider, 'async' | 'sync'>,
): void {
  if (provider.type !== 'factory' || !provider.useFactory) {
    return;
  }

  const originalFactory = provider.useFactory;
  provider.useFactory = (...deps: unknown[]) => {
    const value = originalFactory(...deps);
    factoryResolutionKinds.set(provider, isPromiseLike(value) ? 'async' : 'sync');
    return value;
  };
}

function installFactoryResolutionTracking(
  target: ContainerIntrospection,
  factoryResolutionKinds: WeakMap<NormalizedProvider, 'async' | 'sync'>,
): void {
  if (target.parent) {
    installFactoryResolutionTracking(target.parent, factoryResolutionKinds);
  }

  for (const provider of target.registrations.values()) {
    trackFactoryResolutionKind(provider, factoryResolutionKinds);
  }

  for (const providers of target.multiRegistrations.values()) {
    for (const provider of providers) {
      trackFactoryResolutionKind(provider, factoryResolutionKinds);
    }
  }
}

function providerGraphIsSyncResolvable(state: SyncResolverState, token: Token, visited = new Set<Token>()): boolean {
  if (visited.has(token)) {
    return true;
  }

  visited.add(token);

  try {
    const provider = lookupProvider(state.introspection, token);
    const multiProviders = collectMultiProviders(state.introspection, token);
    const providers = provider ? [provider, ...multiProviders] : multiProviders;

    return providers.every((candidate) => {
      if (candidate.type === 'factory') {
        return state.factoryResolutionKinds.get(candidate) === 'sync';
      }

      if (candidate.type === 'existing') {
        return candidate.useExisting !== undefined && providerGraphIsSyncResolvable(state, candidate.useExisting, visited);
      }

      return candidate.inject.every((entry) => {
        if (isOptionalToken(entry) && !hasToken(state, entry.token)) {
          return true;
        }

        return providerGraphIsSyncResolvable(state, dependencyToken(entry), visited);
      });
    });
  } finally {
    visited.delete(token);
  }
}

function canPromoteCachedSingleton(state: SyncResolverState, token: Token): boolean {
  const provider = lookupProvider(state.introspection, token);

  return provider !== undefined && provider.scope !== 'request' && providerGraphIsSyncResolvable(state, token);
}

function providerGraphForProviderIsSyncResolvable(
  state: SyncResolverState,
  provider: NormalizedProvider,
  visited = new Set<Token>(),
): boolean {
  if (provider.type === 'factory') {
    return state.factoryResolutionKinds.get(provider) === 'sync';
  }

  if (provider.type === 'existing') {
    return provider.useExisting !== undefined && providerGraphIsSyncResolvable(state, provider.useExisting, visited);
  }

  return provider.inject.every((entry) => {
    if (isOptionalToken(entry) && !hasToken(state, entry.token)) {
      return true;
    }

    return providerGraphIsSyncResolvable(state, dependencyToken(entry), visited);
  });
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

  if (state.syncSingletonValues.has(provider.provide)) {
    return state.syncSingletonValues.get(provider.provide);
  }

  if (state.singletonCache.has(provider.provide)) {
    throw new Error(
      `Token ${String(provider.provide)} was already resolved asynchronously. Use resolve() instead of get() for this provider.`,
    );
  }

  const instance = instantiateSyncProvider(provider, state);
  state.syncSingletonValues.set(provider.provide, instance);
  state.singletonCache.set(provider.provide, Promise.resolve(instance));
  return instance;
}

function resolveSyncMultiProvider(provider: NormalizedProvider, state: SyncResolverState): unknown {
  if (provider.scope === 'request' && !state.introspection.requestScopeEnabled) {
    throw new Error(`Request-scoped provider ${String(provider.provide)} cannot be resolved outside request scope.`);
  }

  if (provider.scope === 'transient') {
    return instantiateSyncProvider(provider, state);
  }

  if (state.syncMultiSingletonValues.has(provider)) {
    return state.syncMultiSingletonValues.get(provider);
  }

  if (state.multiSingletonCache.has(provider)) {
    throw new Error(
      `Token ${String(provider.provide)} was already resolved asynchronously. Use resolve() instead of get() for this provider.`,
    );
  }

  const instance = instantiateSyncProvider(provider, state);
  state.syncMultiSingletonValues.set(provider, instance);
  state.multiSingletonCache.set(provider, Promise.resolve(instance));
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
      return multiProviders.map((provider) => resolveSyncMultiProvider(provider, state));
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

function createSyncResolver(container: BootstrapResult['container']): SyncResolver {
  const introspection = toContainerIntrospection(container);
  const factoryResolutionKinds = new WeakMap<NormalizedProvider, 'async' | 'sync'>();

  installFactoryResolutionTracking(introspection, factoryResolutionKinds);

  const state: SyncResolverState = {
    factoryResolutionKinds,
    introspection,
    multiSingletonCache: rootContainerIntrospection(introspection).multiSingletonCache,
    resolutionChain: new Set<Token>(),
    singletonCache: rootContainerIntrospection(introspection).singletonCache,
    syncMultiSingletonValues: new Map<NormalizedProvider, unknown>(),
    syncSingletonValues: new Map<Token, unknown>(),
  };

  return {
    get: <T>(token: Token<T>): T => resolveSyncToken(token, state) as T,
    syncFromContainer: async (): Promise<void> => {
      for (const [token, promise] of state.singletonCache) {
        if (!canPromoteCachedSingleton(state, token)) {
          continue;
        }

        state.syncSingletonValues.set(token, await promise);
      }

      for (const [provider, promise] of state.multiSingletonCache) {
        if (!providerGraphForProviderIsSyncResolvable(state, provider)) {
          continue;
        }

        state.syncMultiSingletonValues.set(provider, await promise);
      }
    },
  };
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
  private readonly originalModuleDefinitions = new Map<ModuleType, ModuleDefinition>();

  constructor(private readonly options: TestingModuleOptions) {}

  addOverride(provider: Provider): void {
    this.overrides.push(provider);
  }

  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;
  overrideProvider<T>(token: Token<T>, provider: Provider<T>): this;
  overrideProvider<T>(token: Token<T>, value: T): this;
  overrideProvider<T>(token: Token<T>, ...rest: [Provider<T> | T] | []): this | OverrideProviderBuilder<T> {
    if (rest.length < 1) {
      return new DefaultOverrideProviderBuilder(this, token);
    }

    const [value] = rest;
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
    const syncResolver = createSyncResolver(bootstrapped.container);

    await runTestingBootstrapLifecycle(bootstrapped);
    await syncResolver.syncFromContainer();

    return this.createTestingModuleRef(bootstrapped, syncResolver);
  }

  private bootstrapTestingModule(): BootstrapResult {
    const bootstrapped = this.bootstrapWithPatchedModuleImports();

    if (this.overrides.length > 0) {
      bootstrapped.container.override(...this.overrides);
    }

    return bootstrapped;
  }

  private bootstrapWithPatchedModuleImports(): BootstrapResult {
    try {
      const rootModule = this._applyModuleReplacements(this.options.rootModule);

      return bootstrapModule(rootModule, {
        providers: this.options.providers,
      });
    } finally {
      this.restorePatchedModuleImports();
    }
  }

  private createTestingModuleRef(bootstrapped: BootstrapResult, syncResolver: SyncResolver): TestingModuleRef {
    const dispatcher = createTestingDispatcher(bootstrapped);

    return {
      ...bootstrapped,
      has: (token) => bootstrapped.container.has(token),
      get: (token) => syncResolver.get(token),
      resolve: async (token) => {
        const value = await bootstrapped.container.resolve(token);
        await syncResolver.syncFromContainer();
        return value;
      },
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

        await syncResolver.syncFromContainer();

        return results;
      },
      dispatch: async (request: TestRequestWithOptions) => {
        const response = await makeRequest(dispatcher, request);
        await syncResolver.syncFromContainer();
        return response;
      },
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

    this.patchModuleImports(module, metadata as ModuleDefinition, rewrittenImports);

    return module;
  }

  private rewriteModuleImports(imports: ModuleType[]): ModuleType[] {
    return imports.map((moduleImport) => this._applyModuleReplacements(moduleImport));
  }

  private patchModuleImports(module: ModuleType, metadata: ModuleDefinition, imports: ModuleType[]): void {
    if (!this.originalModuleDefinitions.has(module)) {
      this.originalModuleDefinitions.set(module, metadata);
    }

    defineModule(module, {
      ...metadata,
      imports,
    });
  }

  private restorePatchedModuleImports(): void {
    for (const [module, metadata] of this.originalModuleDefinitions) {
      defineModule(module, metadata);
    }

    this.originalModuleDefinitions.clear();
  }
}

/**
 * Creates a fluent testing-module builder for overriding providers and compiling a test graph.
 *
 * @param options Bootstrap options plus the root module that should be compiled for the test.
 * @returns A builder that supports provider and module overrides before compilation.
 *
 * @example
 * ```ts
 * const module = await createTestingModule({ rootModule: AppModule })
 *   .overrideProvider(USER_REPOSITORY, fakeUserRepository)
 *   .compile();
 * ```
 */
export function createTestingModule(options: TestingModuleOptions): TestingModuleBuilder {
  return new DefaultTestingModuleBuilder(options);
}

/**
 * Namespace-style access point for `createTestingModule(...)`.
 */
export const Test = {
  createTestingModule,
};
