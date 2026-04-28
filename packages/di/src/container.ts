import { InvariantError, formatTokenName, type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';

import {
  CircularDependencyError,
  ContainerResolutionError,
  DuplicateProviderError,
  InvalidProviderError,
  RequestScopeResolutionError,
  ScopeMismatchError,
} from './errors.js';
import type {
  ClassType,
  ClassProvider,
  Disposable,
  ExistingProvider,
  FactoryProvider,
  ForwardRefFn,
  NormalizedProvider,
  OptionalToken,
  Provider,
  ValueProvider,
} from './types.js';
import { Scope, isForwardRef, isOptionalToken } from './types.js';

type ObjectProvider = ClassProvider | ExistingProvider | FactoryProvider | ValueProvider;

function isClassConstructor(value: Provider): value is ClassType {
  return typeof value === 'function';
}

function isValueProvider(value: Provider): value is ValueProvider {
  return typeof value === 'object' && value !== null && 'useValue' in value;
}

function isFactoryProvider(value: Provider): value is FactoryProvider {
  return typeof value === 'object' && value !== null && 'useFactory' in value;
}

function isClassProvider(value: Provider): value is ClassProvider {
  return typeof value === 'object' && value !== null && 'useClass' in value;
}

function isExistingProvider(value: Provider): value is ExistingProvider {
  return typeof value === 'object' && value !== null && 'useExisting' in value;
}

function assertProviderToken(provider: ObjectProvider): void {
  if (!('provide' in provider) || provider.provide == null) {
    throw new InvalidProviderError('Provider object must include a non-null provide token.');
  }
}

function assertProviderStrategy(provider: ObjectProvider): void {
  const strategyCount = Number('useValue' in provider) + Number('useFactory' in provider) + Number('useClass' in provider) + Number('useExisting' in provider);

  if (strategyCount !== 1) {
    throw new InvalidProviderError('Provider object must declare exactly one of useValue, useFactory, useClass, or useExisting.');
  }
}

function assertObjectProvider(provider: ObjectProvider): void {
  assertProviderToken(provider);
  assertProviderStrategy(provider);
}

function normalizeInjectToken(token: Token | ForwardRefFn | OptionalToken): Token | ForwardRefFn | OptionalToken {
  if (token == null) {
    throw new InvalidProviderError('Inject token must not be null or undefined. Check that all tokens in @Inject(...) are defined at the point of decoration (forward-reference cycles require forwardRef()).');
  }

  return token;
}

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return {
      inject: (metadata?.inject ?? []).map(normalizeInjectToken),
      provide: provider,
      scope: metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    };
  }

  if (isValueProvider(provider)) {
    assertObjectProvider(provider);

    return {
      inject: [],
      multi: provider.multi,
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'value',
      useValue: provider.useValue,
    };
  }

  if (isFactoryProvider(provider)) {
    assertObjectProvider(provider);

    if (typeof provider.useFactory !== 'function') {
      throw new InvalidProviderError('Factory provider useFactory must be a function.', { token: provider.provide });
    }

    const metadata = provider.resolverClass ? getClassDiMetadata(provider.resolverClass) : undefined;

    return {
      inject: (provider.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'factory',
      useFactory: provider.useFactory,
    };
  }

  if (isClassProvider(provider)) {
    assertObjectProvider(provider);

    if (typeof provider.useClass !== 'function') {
      throw new InvalidProviderError('Class provider useClass must be a constructor.', { token: provider.provide });
    }

    const metadata = getClassDiMetadata(provider.useClass);

    return {
      inject: (provider.inject ?? metadata?.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider.useClass,
    };
  }

  if (isExistingProvider(provider)) {
    assertObjectProvider(provider);

    if (provider.useExisting == null) {
      throw new InvalidProviderError('Alias provider useExisting must be a non-null token.', { token: provider.provide });
    }

    return {
      inject: [],
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'existing',
      useExisting: provider.useExisting,
    };
  }

  throw new InvalidProviderError('Unsupported provider type.');
}

/**
 * Scope-aware dependency injection container for Fluo providers.
 */
export class Container {
  private readonly registrations = new Map<Token, NormalizedProvider>();
  private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
  private readonly multiOverriddenTokens = new Set<Token>();
  private readonly requestCache = new Map<Token, Promise<unknown>>();
  private readonly multiRequestCache = new Map<NormalizedProvider, Promise<unknown>>();
  private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
  private readonly staleDisposalTasks = new Set<Promise<void>>();
  private readonly staleDisposalErrors: unknown[] = [];
  private readonly singletonCache: Map<Token, Promise<unknown>>;
  private readonly forwardRefTokenCache = new WeakMap<ForwardRefFn, Token>();
  private readonly childScopes = new Set<Container>();
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  constructor(
    private readonly parent?: Container,
    private readonly requestScopeEnabled = false,
    singletonCache?: Map<Token, Promise<unknown>>,
  ) {
    this.singletonCache = singletonCache ?? new Map<Token, Promise<unknown>>();
  }

  /**
   * Registers providers in the current container scope.
   *
   * @param providers Provider definitions to register in this container.
   * @returns The same container instance for fluent registration chains.
   * @throws {ContainerResolutionError} When called after the container was disposed.
   * @throws {ScopeMismatchError} When registering singleton providers directly on a request scope.
   * @throws {DuplicateProviderError} When registration conflicts with existing single/multi mappings.
   * @throws {InvalidProviderError} When a provider definition is structurally invalid.
   */
  register(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer register providers.',
        { hint: 'Ensure providers are registered before calling container.dispose().' },
      );
    }

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      if (this.requestScopeEnabled && normalized.scope === Scope.DEFAULT) {
        throw new ScopeMismatchError(
          `Singleton provider ${String(normalized.provide)} cannot be registered on a request-scope container.`,
          {
            token: normalized.provide,
            scope: 'singleton',
            hint: 'Register it on the root container before creating the request scope, or use container.override() within the request scope instead.',
          },
        );
      }

      this.assertNoRegistrationConflict(normalized.provide, normalized.multi === true);

      if (normalized.multi) {
        const existing = this.multiRegistrations.get(normalized.provide);

        if (existing) {
          existing.push(normalized);
          continue;
        }

        this.multiRegistrations.set(normalized.provide, [normalized]);
      } else {
        this.registrations.set(normalized.provide, normalized);
      }
    }

    return this;
  }

  /**
   * Override one or more already-registered providers.
   *
   * **Multi-provider destructive replacement**: when the incoming provider has `multi: true`,
   * the entire existing multi-registration array for that token is deleted before the new entry
   * is added. There is intentionally no way to replace a single entry within a multi-provider
   * set — the whole set is replaced. If you need to preserve other entries, re-register them
   * together with the replacement in one `override()` call.
   *
   * @param providers Provider definitions that should replace existing registrations for each token.
   * @returns The same container instance for fluent override chains.
   * @throws {ContainerResolutionError} When called after the container was disposed.
   * @throws {InvalidProviderError} When a provider definition is structurally invalid.
   */
  override(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer override providers.',
        { hint: 'Ensure overrides are applied before calling container.dispose().' },
      );
    }

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const existing = this.lookupProvider(normalized.provide);

      this.registrations.delete(normalized.provide);
      this.multiRegistrations.delete(normalized.provide);
      this.invalidateCachedEntry(normalized.provide, existing?.scope ?? normalized.scope);

      if (normalized.multi) {
        this.multiRegistrations.set(normalized.provide, [normalized]);
        this.multiOverriddenTokens.add(normalized.provide);
        continue;
      }

      this.multiOverriddenTokens.add(normalized.provide);
      this.registrations.set(normalized.provide, normalized);
    }

    return this;
  }

  /**
   * Returns whether a token is registered in this scope chain.
   *
   * @param token Token to check across this container and its ancestors.
   * @returns `true` when a single or multi provider exists for the token.
   */
  has(token: Token): boolean {
    return this.lookupProvider(token) !== undefined || this.hasMulti(token);
  }

  /**
   * Creates a child request-scope container that shares root singleton cache.
   *
   * @returns A request-scope child container bound to this container hierarchy.
   * @throws {ContainerResolutionError} When called after the container was disposed.
   */
  createRequestScope(): Container {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer create request scopes.',
        { hint: 'Create request scopes before calling container.dispose().' },
      );
    }

    const child = new Container(this, true, this.root().singletonCache);
    this.root().childScopes.add(child);
    return child;
  }

  /**
   * Resolves a token to an instance using scope-aware caching rules.
   *
   * @param token Token to resolve.
   * @returns A promise that resolves to the token instance (or multi-provider instance array).
   * @throws {ContainerResolutionError} When called after disposal or when no provider is registered.
   * @throws {RequestScopeResolutionError} When request-scoped providers are resolved from root scope.
   * @throws {ScopeMismatchError} When singleton providers depend on request-scoped providers.
   * @throws {CircularDependencyError} When provider dependency resolution detects a cycle.
   */
  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer resolve providers.',
        { token, hint: 'Ensure all resolves complete before calling container.dispose().' },
      );
    }

    return this.resolveWithChain(token, [], new Set<Token>());
  }

  /**
   * Disposes cached instances and nested request scopes.
   *
   * @returns A promise that settles after all cached disposable instances are torn down.
   * @throws {Error} Propagates one or more disposal errors (`AggregateError` when multiple failures occur).
   */
  async dispose(): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }

    this.disposed = true;
    this.disposePromise = this.disposeAll();

    try {
      await this.disposePromise;
    } catch (error) {
      this.disposePromise = undefined;
      throw error;
    }
  }

  private async disposeAll(): Promise<void> {
    try {
      // Dispose all live request-scope children first (root only)
      if (!this.parent && this.childScopes.size > 0) {
        await Promise.all(Array.from(this.childScopes).map((child) => child.dispose()));
        this.childScopes.clear();
      }

      await this.disposeCache(this.disposalCacheEntries());
    } finally {
      if (this.parent) {
        this.root().childScopes.delete(this);
      }
    }
  }

  private hasMulti(token: Token): boolean {
    if (this.multiRegistrations.has(token)) return true;

    return this.parent?.hasMulti(token) ?? false;
  }

  private assertNoRegistrationConflict(token: Token, multi: boolean): void {
    if (multi) {
      if (this.registrations.has(token)) {
        throw new DuplicateProviderError(token);
      }

      if (this.hasAncestorSingleRegistration(token)) {
        throw new DuplicateProviderError(token);
      }

      return;
    }

    if (this.registrations.has(token) || this.multiRegistrations.has(token)) {
      throw new DuplicateProviderError(token);
    }

    if (this.hasAncestorMultiRegistration(token)) {
      throw new DuplicateProviderError(token);
    }
  }

  private hasAncestorSingleRegistration(token: Token): boolean {
    return this.parent?.hasSingleRegistration(token) ?? false;
  }

  private hasSingleRegistration(token: Token): boolean {
    if (this.registrations.has(token)) return true;

    return this.parent?.hasSingleRegistration(token) ?? false;
  }

  private hasAncestorMultiRegistration(token: Token): boolean {
    return this.parent?.hasMultiRegistration(token) ?? false;
  }

  private hasMultiRegistration(token: Token): boolean {
    if (this.multiRegistrations.has(token)) return true;

    return this.parent?.hasMultiRegistration(token) ?? false;
  }

  private collectMultiProviders(token: Token): NormalizedProvider[] {
    const local = this.multiRegistrations.get(token);

    if (this.multiOverriddenTokens.has(token)) {
      return local ?? [];
    }

    const fromParent = this.parent ? this.parent.collectMultiProviders(token) : [];

    if (local) {
      return [...fromParent, ...local];
    }

    return fromParent;
  }

  private async resolveWithChain<T>(
    token: Token<T>,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef = false,
  ): Promise<T> {
    const cachedForwardRef = this.resolveForwardRefCircularDependency(token, chain, activeTokens, allowForwardRef);

    if (cachedForwardRef !== undefined) {
      return (await cachedForwardRef) as T;
    }

    return await this.resolveFromRegisteredProviders(token, chain, activeTokens);
  }

  private async resolveFromRegisteredProviders<T>(token: Token<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    const localSingleProvider = this.registrations.get(token);

    if (!localSingleProvider) {
      const multiProviders = this.collectMultiProviders(token);

      if (multiProviders.length > 0) {
        const instances = await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
          this.resolveMultiProviderInstances(multiProviders, c, at),
        );

        return instances as T;
      }
    }

    const provider = this.requireProvider(token);
    const existingTarget = this.resolveExistingProviderTarget(provider);

    if (existingTarget !== undefined) {
      return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
    }

    if (provider.scope === 'transient') {
      return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
    }

    const cachedInstance = this.getCachedScopedOrSingletonInstance(provider);

    if (cachedInstance) {
      return (await cachedInstance) as T;
    }

    return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveScopedOrSingletonInstance(provider, c, at),
    )) as T;
  }

  private requireProvider(token: Token): NormalizedProvider {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(
        `No provider registered for token ${formatTokenName(token)}.`,
        {
          token,
          hint: 'Ensure the provider is registered in a module\'s providers array, or that the module exporting it is imported by the consuming module.',
        },
      );
    }

    return provider;
  }

  private async resolveAliasTarget<T>(existingTarget: Token<T>, token: Token, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    return await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveWithChain(existingTarget, c, at),
    );
  }

  private resolveForwardRefCircularDependency(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef: boolean,
  ): Promise<unknown> | undefined {
    if (!activeTokens.has(token)) {
      return undefined;
    }

    if (allowForwardRef) {
      throw new CircularDependencyError(
        [...chain, token],
        'forwardRef only defers token lookup and does not resolve true circular construction.',
      );
    }

    throw new CircularDependencyError([...chain, token]);
  }

  private async resolveMultiProviderInstances(
    providers: readonly NormalizedProvider[],
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown[]> {
    const instances: unknown[] = [];

    for (const provider of providers) {
      instances.push(await this.resolveMultiProviderInstance(provider, chain, activeTokens));
    }

    return instances;
  }

  private async resolveMultiProviderInstance(
    provider: NormalizedProvider,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (provider.type === 'existing') {
      return await this.resolveWithChain(provider.useExisting as Token, chain, activeTokens);
    }

    if (provider.scope === 'transient') {
      return await this.instantiate(provider, chain, activeTokens);
    }

    if (this.shouldResolveMultiProviderFromRoot(provider)) {
      return await this.root().resolveMultiProviderInstance(provider, chain, activeTokens);
    }

    const cache = this.multiCacheFor(provider);

    if (!cache.has(provider)) {
      const promise = this.instantiate(provider, chain, activeTokens);
      cache.set(provider, promise);
      promise.catch(() => cache.delete(provider));
    }

    return await cache.get(provider)!;
  }

  private resolveExistingProviderTarget(provider: NormalizedProvider): Token | undefined {
    if (provider.type !== 'existing') {
      return undefined;
    }

    return provider.useExisting;
  }

  private async resolveScopedOrSingletonInstance(
    provider: NormalizedProvider,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (this.shouldResolveFromRoot(provider)) {
      return await this.root().resolveScopedOrSingletonInstance(provider, chain, activeTokens);
    }

    const cache = this.cacheFor(provider);

    if (!cache.has(provider.provide)) {
      const promise = this.instantiate(provider, chain, activeTokens).catch((error: unknown) => {
        cache.delete(provider.provide);
        throw error;
      });

      cache.set(provider.provide, promise);
    }

    return cache.get(provider.provide);
  }

  private getCachedScopedOrSingletonInstance(provider: NormalizedProvider): Promise<unknown> | undefined {
    if (provider.scope !== Scope.DEFAULT) {
      return undefined;
    }

    if (this.shouldResolveFromRoot(provider)) {
      return this.root().getCachedScopedOrSingletonInstance(provider);
    }

    return this.cacheFor(provider).get(provider.provide);
  }

  private shouldResolveFromRoot(provider: NormalizedProvider): boolean {
    return provider.scope === Scope.DEFAULT && this.requestScopeEnabled && !this.registrations.has(provider.provide);
  }

  private shouldResolveMultiProviderFromRoot(provider: NormalizedProvider): boolean {
    return provider.scope === Scope.DEFAULT && this.requestScopeEnabled && !this.hasLocalMultiProvider(provider);
  }

  private async resolveDepToken(
    depEntry: Token | ForwardRefFn | OptionalToken,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (isOptionalToken(depEntry)) {
      const innerToken = depEntry.token;

      if (!this.has(innerToken)) {
        return undefined;
      }

      return this.resolveWithChain(innerToken, chain, activeTokens);
    }

    if (isForwardRef(depEntry)) {
      const resolvedToken = this.resolveForwardRefToken(depEntry);

      return this.resolveWithChain(resolvedToken, chain, activeTokens, /* allowForwardRef */ true);
    }

    return this.resolveWithChain(depEntry as Token, chain, activeTokens);
  }

  private async withTokenInChain<T>(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    run: (chain: Token[], activeTokens: Set<Token>) => Promise<T>,
  ): Promise<T> {
    chain.push(token);
    activeTokens.add(token);

    try {
      return await run(chain, activeTokens);
    } finally {
      activeTokens.delete(token);
      chain.pop();
    }
  }

  private root(): Container {
    return this.parent ? this.parent.root() : this;
  }

  private lookupProvider(token: Token): NormalizedProvider | undefined {
    const local = this.registrations.get(token);

    if (local) {
      return local;
    }

    return this.parent?.lookupProvider(token);
  }

  /**
   * Resolve the cache map that should hold the instance for `provider`.
   *
   * **Singleton-in-request-scope**: if a provider with `scope: 'singleton'` (the default) is
   * registered directly on a request-scope child container (rather than the root), it is cached
   * in the child's `requestCache` instead of the root's `singletonCache`. This means it behaves
   * as request-scoped despite the singleton scope annotation. This is intentional — it allows
   * test and override scenarios to inject short-lived values without polluting the global cache
   * — but the divergence from the declared scope is a known footgun for consumers who
   * inadvertently register singletons on child containers.
   */
  private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.registrations.has(provider.provide)) {
        return this.requestCache;
      }

      return this.root().singletonCache;
    }

    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${formatTokenName(provider.provide)} cannot be resolved outside request scope.`,
        {
          token: provider.provide,
          scope: 'request',
          hint: 'Wrap the resolve call inside a request-scoped child container created via container.createRequestScope().',
        },
      );
    }

    return this.requestCache;
  }

  private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
        return this.multiRequestCache;
      }

      return this.root().multiSingletonCache;
    }

    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${formatTokenName(provider.provide)} cannot be resolved outside request scope.`,
        {
          token: provider.provide,
          scope: 'request',
          hint: 'Wrap the resolve call inside a request-scoped child container created via container.createRequestScope().',
        },
      );
    }

    return this.multiRequestCache;
  }

  private hasLocalMultiProvider(provider: NormalizedProvider): boolean {
    return this.multiRegistrations.get(provider.provide)?.includes(provider) ?? false;
  }

  private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
    if (this.parent) {
      const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.requestCache.entries());

      for (const [provider, promise] of this.multiRequestCache.entries()) {
        entries.push([provider, promise]);
      }

      return entries;
    }

    const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.singletonCache.entries());
    for (const [provider, promise] of this.multiSingletonCache.entries()) {
      entries.push([provider, promise]);
    }
    return entries;
  }

  private async disposeCache(entries: Array<[NormalizedProvider | Token, Promise<unknown>]>): Promise<void> {
    await this.waitForStaleDisposalTasks();

    const { disposables, errors } = await this.collectDisposableInstances(entries);

    errors.push(...this.staleDisposalErrors.splice(0, this.staleDisposalErrors.length));

    errors.push(...(await this.disposeInstancesInReverseOrder(disposables)));

    this.clearDisposalCaches();
    this.throwDisposalErrors(errors);
  }

  private async collectDisposableInstances(
    entries: Array<[NormalizedProvider | Token, Promise<unknown>]>,
  ): Promise<{ disposables: Disposable[]; errors: unknown[] }> {
    const disposables: Disposable[] = [];
    const seenInstances = new Set<unknown>();
    const errors: unknown[] = [];

    const settled = await Promise.allSettled(entries.map(([, p]) => p));

    for (const result of settled) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
        continue;
      }

      const instance = result.value;

      if (this.isDisposable(instance) && !seenInstances.has(instance)) {
        seenInstances.add(instance);
        disposables.push(instance);
      }
    }

    return { disposables, errors };
  }

  private async disposeInstancesInReverseOrder(disposables: readonly Disposable[]): Promise<unknown[]> {
    const errors: unknown[] = [];

    for (const instance of [...disposables].reverse()) {
      try {
        await instance.onDestroy();
      } catch (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  private clearDisposalCaches(): void {
    if (this.parent) {
      this.requestCache.clear();
      this.multiRequestCache.clear();
      return;
    }

    this.singletonCache.clear();
    this.multiSingletonCache.clear();
  }

  private async waitForStaleDisposalTasks(): Promise<void> {
    while (this.staleDisposalTasks.size > 0) {
      await Promise.all(Array.from(this.staleDisposalTasks));
    }
  }

  private scheduleStaleDisposal(instancePromise: Promise<unknown>): void {
    let task: Promise<void>;

    task = (async () => {
      try {
        const instance = await instancePromise;

        if (this.isDisposable(instance)) {
          await instance.onDestroy();
        }
      } catch (error) {
        this.staleDisposalErrors.push(error);
      }
    })().finally(() => {
      this.staleDisposalTasks.delete(task);
    });

    this.staleDisposalTasks.add(task);
  }

  private throwDisposalErrors(errors: unknown[]): void {
    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, 'Container disposal failed for one or more providers.');
    }
  }

  private isDisposable(value: unknown): value is Disposable {
    return typeof value === 'object' && value !== null && 'onDestroy' in value && typeof value.onDestroy === 'function';
  }

  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    this.assertSingletonDependencyScopes(provider);

    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'existing':
        return await this.resolveWithChain(provider.useExisting as Token<T>, [], new Set());
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

          const deps = await this.resolveProviderDeps(provider, chain, activeTokens);

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await this.resolveProviderDeps(provider, chain, activeTokens);

        return new provider.useClass(...deps) as T;
      }
      default:
        throw new InvariantError('Unknown provider type.');
    }
  }

  private assertSingletonDependencyScopes(provider: NormalizedProvider): void {
    if (provider.scope !== Scope.DEFAULT) {
      return;
    }

    for (const depEntry of provider.inject) {
      const depToken = this.resolveProviderDependencyToken(depEntry);
      const effectiveProvider = this.resolveEffectiveProvider(depToken);

      if (effectiveProvider?.scope === 'request') {
        throw new ScopeMismatchError(
          `Singleton provider ${formatTokenName(provider.provide)} depends on request-scoped provider ${formatTokenName(depToken)}.`,
          {
            token: provider.provide,
            scope: 'singleton',
            hint: `Singleton providers cannot depend on request-scoped providers. Either change ${formatTokenName(depToken)} to singleton/transient scope, or change ${formatTokenName(provider.provide)} to request scope.`,
          },
        );
      }
    }
  }

  private resolveEffectiveProvider(
    token: Token,
    visited = new Set<Token>(),
    chain: Token[] = [],
  ): NormalizedProvider | undefined {
    let currentToken = token;

    while (true) {
      if (visited.has(currentToken)) {
        throw new CircularDependencyError([...chain, currentToken]);
      }

      visited.add(currentToken);

      const provider = this.lookupProvider(currentToken);

      if (!provider) {
        return undefined;
      }

      if (provider.type !== 'existing' || provider.useExisting === undefined) {
        return provider;
      }

      chain.push(currentToken);
      currentToken = provider.useExisting;
    }
  }

  private resolveProviderDependencyToken(depEntry: Token | ForwardRefFn | OptionalToken): Token {
    if (isForwardRef(depEntry)) {
      return this.resolveForwardRefToken(depEntry);
    }

    if (isOptionalToken(depEntry)) {
      return depEntry.token;
    }

    return depEntry as Token;
  }

  private resolveForwardRefToken(forwardRefEntry: ForwardRefFn): Token {
    if (this.forwardRefTokenCache.has(forwardRefEntry)) {
      return this.forwardRefTokenCache.get(forwardRefEntry)!;
    }

    const resolvedToken = forwardRefEntry.forwardRef();
    this.forwardRefTokenCache.set(forwardRefEntry, resolvedToken);
    return resolvedToken;
  }

  private async resolveProviderDeps(provider: NormalizedProvider, chain: Token[], activeTokens: Set<Token>): Promise<unknown[]> {
    const deps = new Array<unknown>(provider.inject.length);

    for (const [index, entry] of provider.inject.entries()) {
      deps[index] = await this.resolveDepToken(entry, chain, activeTokens);
    }

    return deps;
  }

  private invalidateCachedEntry(token: Token, scope: Scope): void {
    if (this.requestCache.has(token)) {
      const cached = this.requestCache.get(token);

      if (cached) {
        this.scheduleStaleDisposal(cached);
      }

      this.requestCache.delete(token);
    }

    if (!this.parent && scope === Scope.DEFAULT) {
      const singletonCache = this.singletonCache;

      if (singletonCache.has(token)) {
        const cached = singletonCache.get(token);

        if (cached) {
          this.scheduleStaleDisposal(cached);
        }

        singletonCache.delete(token);
      }
    }

    if (!this.parent) {
      for (const [provider, cached] of this.multiSingletonCache.entries()) {
        if (provider.provide !== token) {
          continue;
        }

        this.scheduleStaleDisposal(cached);
        this.multiSingletonCache.delete(provider);
      }
    }

    for (const [provider, cached] of this.multiRequestCache.entries()) {
      if (provider.provide !== token) {
        continue;
      }

      this.scheduleStaleDisposal(cached);
      this.multiRequestCache.delete(provider);
    }
  }
}
