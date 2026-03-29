import { InvariantError, getClassDiMetadata, type Token } from '@konekti/core';

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

function normalizeInjectToken(token: Token | ForwardRefFn | OptionalToken): Token | ForwardRefFn | OptionalToken {
  if (token == null) {
    throw new InvalidProviderError('Inject token must not be null or undefined. Check that all tokens in @Inject([...]) are defined at the point of decoration (forward-reference cycles require forwardRef()).');
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
    return {
      inject: (provider.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? Scope.DEFAULT,
      type: 'factory',
      useFactory: provider.useFactory,
    };
  }

  if (isClassProvider(provider)) {
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

export class Container {
  private readonly registrations = new Map<Token, NormalizedProvider>();
  private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
  private readonly multiOverriddenTokens = new Set<Token>();
  private readonly requestCache = new Map<Token, Promise<unknown>>();
  private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
  private readonly staleDisposalTasks = new Set<Promise<void>>();
  private readonly staleDisposalErrors: unknown[] = [];
  private readonly singletonCache: Map<Token, Promise<unknown>>;
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

  register(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError('Container has been disposed and can no longer register providers.');
    }

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

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
   */
  override(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError('Container has been disposed and can no longer override providers.');
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

      this.registrations.set(normalized.provide, normalized);
    }

    return this;
  }

  has(token: Token): boolean {
    return this.lookupProvider(token) !== undefined || this.hasMulti(token);
  }

  createRequestScope(): Container {
    if (this.disposed) {
      throw new ContainerResolutionError('Container has been disposed and can no longer create request scopes.');
    }

    const child = new Container(this, true, this.root().singletonCache);
    this.root().childScopes.add(child);
    return child;
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.disposed) {
      throw new ContainerResolutionError('Container has been disposed and can no longer resolve providers.');
    }

    return this.resolveWithChain(token, [], new Set<Token>());
  }

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
    // Dispose all live request-scope children first (root only)
    if (!this.parent && this.childScopes.size > 0) {
      await Promise.all(Array.from(this.childScopes).map((child) => child.dispose()));
      this.childScopes.clear();
    }

    await this.disposeCache(this.disposalCacheEntries());
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
    const multiProviders = this.collectMultiProviders(token);

    if (multiProviders.length > 0) {
      const instances = await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
        this.resolveMultiProviderInstances(multiProviders, c, at),
      );

      return instances as T;
    }

    const provider = this.requireProvider(token);
    const existingTarget = this.resolveExistingProviderTarget(provider);

    if (existingTarget !== undefined) {
      return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
    }

    if (provider.scope === 'transient') {
      return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
    }

    return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveScopedOrSingletonInstance(provider, c, at),
    )) as T;
  }

  private requireProvider(token: Token): NormalizedProvider {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(`No provider registered for token ${String(token)}.`);
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
      // A forwardRef dep is in the chain — return the partially-initialized
      // instance from the singleton cache if it is already being constructed.
      const cache = this.singletonCacheFor(token);

      if (cache?.has(token)) {
        return cache.get(token);
      }
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
      if (provider.type === 'existing') {
        instances.push(await this.resolveWithChain(provider.useExisting as Token, chain, activeTokens));
        continue;
      }

      if (provider.scope === 'transient') {
        instances.push(await this.instantiate(provider, chain, activeTokens));
        continue;
      }

      const rootCache = this.root().multiSingletonCache;

      if (!rootCache.has(provider)) {
        const promise = this.instantiate(provider, chain, activeTokens);
        rootCache.set(provider, promise);
        promise.catch(() => rootCache.delete(provider));
      }

      instances.push(await rootCache.get(provider)!);
    }

    return instances;
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

  private singletonCacheFor(token: Token): Map<Token, Promise<unknown>> | undefined {
    const provider = this.lookupProvider(token);

    if (!provider || provider.scope !== Scope.DEFAULT) return undefined;

    if (this.requestScopeEnabled && this.registrations.has(token)) {
      return this.requestCache;
    }

    return this.root().singletonCache;
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
      const resolvedToken = depEntry.forwardRef();

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
    const nextChain = [...chain, token];
    const nextActiveTokens = new Set([...activeTokens, token]);

    return await run(nextChain, nextActiveTokens);
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
        `Request-scoped provider ${String(provider.provide)} cannot be resolved outside request scope.`,
      );
    }

    return this.requestCache;
  }

  private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
    if (this.parent) {
      return Array.from(this.requestCache.entries());
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
          `Singleton provider ${String(provider.provide)} depends on request-scoped provider ${String(depToken)}. ` +
            'Singleton providers cannot depend on request-scoped providers.',
        );
      }
    }
  }

  private resolveEffectiveProvider(
    token: Token,
    visited = new Set<Token>(),
    chain: Token[] = [],
  ): NormalizedProvider | undefined {
    if (visited.has(token)) {
      throw new CircularDependencyError([...chain, token]);
    }

    visited.add(token);

    const provider = this.lookupProvider(token);

    if (!provider) {
      return undefined;
    }

    if (provider.type === 'existing' && provider.useExisting !== undefined) {
      return this.resolveEffectiveProvider(provider.useExisting, visited, [...chain, token]);
    }

    return provider;
  }

  private resolveProviderDependencyToken(depEntry: Token | ForwardRefFn | OptionalToken): Token {
    if (isForwardRef(depEntry)) {
      return depEntry.forwardRef();
    }

    if (isOptionalToken(depEntry)) {
      return depEntry.token;
    }

    return depEntry as Token;
  }

  private async resolveProviderDeps(provider: NormalizedProvider, chain: Token[], activeTokens: Set<Token>): Promise<unknown[]> {
    const deps: unknown[] = [];

    for (const entry of provider.inject) {
      deps.push(await this.resolveDepToken(entry, chain, activeTokens));
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
  }
}
