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
  Scope,
  ValueProvider,
} from './types.js';
import { isForwardRef, isOptionalToken } from './types.js';

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
  return token;
}

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return {
      inject: (metadata?.inject ?? []).map(normalizeInjectToken),
      provide: provider,
      scope: metadata?.scope ?? 'singleton',
      type: 'class',
      useClass: provider,
    };
  }

  if (isValueProvider(provider)) {
    return {
      inject: [],
      multi: provider.multi,
      provide: provider.provide,
      scope: 'singleton',
      type: 'value',
      useValue: provider.useValue,
    };
  }

  if (isFactoryProvider(provider)) {
    return {
      inject: (provider.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? 'singleton',
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
      scope: provider.scope ?? metadata?.scope ?? 'singleton',
      type: 'class',
      useClass: provider.useClass,
    };
  }

  if (isExistingProvider(provider)) {
    return {
      inject: [],
      provide: provider.provide,
      scope: 'singleton',
      type: 'existing',
      useExisting: provider.useExisting,
    };
  }

  throw new InvalidProviderError('Unsupported provider type.');
}

export class Container {
  private readonly registrations = new Map<Token, NormalizedProvider>();
  private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
  private readonly requestCache = new Map<Token, Promise<unknown>>();
  private readonly staleCache = new Map<Token, Promise<unknown>>();
  private readonly singletonCache: Map<Token, Promise<unknown>>;
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
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      if (normalized.multi) {
        const existing = this.multiRegistrations.get(normalized.provide) ?? [];

        this.multiRegistrations.set(normalized.provide, [...existing, normalized]);
      } else {
        if (this.registrations.has(normalized.provide)) {
          throw new DuplicateProviderError(normalized.provide);
        }

        this.registrations.set(normalized.provide, normalized);
      }
    }

    return this;
  }

  override(...providers: Provider[]): this {
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const existing = this.lookupProvider(normalized.provide);

      this.registrations.delete(normalized.provide);
      this.multiRegistrations.delete(normalized.provide);
      this.invalidateCachedEntry(normalized.provide, existing?.scope ?? normalized.scope);

      if (normalized.multi) {
        this.multiRegistrations.set(normalized.provide, [normalized]);
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

    return new Container(this, true, this.root().singletonCache);
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.disposed) {
      throw new ContainerResolutionError('Container has been disposed and can no longer resolve providers.');
    }

    return this.resolveWithChain(token, []);
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) {
      await this.disposePromise;
      return;
    }

    this.disposed = true;
    this.disposePromise = this.disposeCache(this.disposalCacheEntries());

    try {
      await this.disposePromise;
    } catch (error) {
      this.disposed = false;
      this.disposePromise = undefined;
      throw error;
    }
  }

  private hasMulti(token: Token): boolean {
    if (this.multiRegistrations.has(token)) return true;

    return this.parent?.hasMulti(token) ?? false;
  }

  private collectMultiProviders(token: Token): NormalizedProvider[] {
    const parentProviders = this.parent?.collectMultiProviders(token) ?? [];
    const local = this.multiRegistrations.get(token) ?? [];

    return [...parentProviders, ...local];
  }

  private async resolveWithChain<T>(token: Token<T>, chain: Token[], allowForwardRef = false): Promise<T> {
    const cachedForwardRef = this.resolveForwardRefCircularDependency(token, chain, allowForwardRef);

    if (cachedForwardRef !== undefined) {
      return (await cachedForwardRef) as T;
    }

    return await this.resolveFromRegisteredProviders(token, chain);
  }

  private async resolveFromRegisteredProviders<T>(token: Token<T>, chain: Token[]): Promise<T> {
    const multiProviders = this.collectMultiProviders(token);

    if (multiProviders.length > 0) {
      const instances = await this.resolveMultiProviderInstances(multiProviders, chain, token);

      return instances as unknown as T;
    }

    const provider = this.requireProvider(token);
    const existingTarget = this.resolveExistingProviderTarget(provider);

    if (existingTarget !== undefined) {
      return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain);
    }

    if (provider.scope === 'transient') {
      return (await this.instantiate(provider, [...chain, token])) as T;
    }

    return (await this.resolveScopedOrSingletonInstance(provider, [...chain, token])) as T;
  }

  private requireProvider(token: Token): NormalizedProvider {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(`No provider registered for token ${String(token)}.`);
    }

    return provider;
  }

  private async resolveAliasTarget<T>(existingTarget: Token<T>, token: Token, chain: Token[]): Promise<T> {
    return await this.resolveWithChain(existingTarget, [...chain, token]);
  }

  private resolveForwardRefCircularDependency(
    token: Token,
    chain: Token[],
    allowForwardRef: boolean,
  ): Promise<unknown> | undefined {
    if (!chain.includes(token)) {
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
    token: Token,
  ): Promise<unknown[]> {
    return Promise.all(providers.map((provider) => this.instantiate(provider, [...chain, token])));
  }

  private resolveExistingProviderTarget(provider: NormalizedProvider): Token | undefined {
    if (provider.type !== 'existing') {
      return undefined;
    }

    return provider.useExisting;
  }

  private async resolveScopedOrSingletonInstance(provider: NormalizedProvider, chain: Token[]): Promise<unknown> {
    const cache = this.cacheFor(provider);

    if (!cache.has(provider.provide)) {
      const promise = this.instantiate(provider, chain);

      cache.set(provider.provide, promise);
      promise.catch(() => cache.delete(provider.provide));
    }

    return cache.get(provider.provide);
  }

  private singletonCacheFor(token: Token): Map<Token, Promise<unknown>> | undefined {
    const provider = this.lookupProvider(token);

    if (!provider || provider.scope !== 'singleton') return undefined;

    if (this.requestScopeEnabled && this.registrations.has(token)) {
      return this.requestCache;
    }

    return this.root().singletonCache;
  }

  private async resolveDepToken(
    depEntry: Token | ForwardRefFn | OptionalToken,
    chain: Token[],
  ): Promise<unknown> {
    if (isOptionalToken(depEntry)) {
      const innerToken = depEntry.token;

      if (!this.has(innerToken)) {
        return undefined;
      }

      return this.resolveWithChain(innerToken, chain);
    }

    if (isForwardRef(depEntry)) {
      const resolvedToken = depEntry.forwardRef();

      return this.resolveWithChain(resolvedToken, chain, /* allowForwardRef */ true);
    }

    return this.resolveWithChain(depEntry as Token, chain);
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

  private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
    if (provider.scope === 'singleton') {
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

  private disposalCacheEntries(): Array<[Token, Promise<unknown>]> {
    if (this.parent) {
      return [...Array.from(this.staleCache.entries()), ...Array.from(this.requestCache.entries())];
    }

    return [...Array.from(this.staleCache.entries()), ...Array.from(this.singletonCache.entries())];
  }

  private async disposeCache(entries: Array<[Token, Promise<unknown>]>): Promise<void> {
    const { disposables, errors } = await this.collectDisposableInstances(entries);

    errors.push(...(await this.disposeInstancesInReverseOrder(disposables)));

    this.clearDisposalCaches();
    this.throwDisposalErrors(errors);
  }

  private async collectDisposableInstances(
    entries: Array<[Token, Promise<unknown>]>,
  ): Promise<{ disposables: Disposable[]; errors: unknown[] }> {
    const disposables: Disposable[] = [];
    const seenInstances = new Set<unknown>();
    const errors: unknown[] = [];

    for (const [, instancePromise] of entries) {
      try {
        const instance = await instancePromise;

        if (this.isDisposable(instance) && !seenInstances.has(instance)) {
          seenInstances.add(instance);
          disposables.push(instance);
        }
      } catch (error) {
        errors.push(error);
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
      this.staleCache.clear();
      return;
    }

    this.singletonCache.clear();
    this.staleCache.clear();
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

  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[]): Promise<T> {
    this.assertSingletonDependencyScopes(provider);

    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await this.resolveProviderDeps(provider, chain);

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await this.resolveProviderDeps(provider, chain);

        return new provider.useClass(...deps) as T;
      }
      default:
        throw new InvariantError('Unknown provider type.');
    }
  }

  private assertSingletonDependencyScopes(provider: NormalizedProvider): void {
    if (provider.scope !== 'singleton') {
      return;
    }

    for (const depEntry of provider.inject) {
      const depToken = this.resolveProviderDependencyToken(depEntry);
      const depProvider = this.lookupProvider(depToken);

      if (depProvider?.scope === 'request') {
        throw new ScopeMismatchError(
          `Singleton provider ${String(provider.provide)} depends on request-scoped provider ${String(depToken)}. ` +
            'Singleton providers cannot depend on request-scoped providers.',
        );
      }
    }
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

  private async resolveProviderDeps(provider: NormalizedProvider, chain: Token[]): Promise<unknown[]> {
    return Promise.all(provider.inject.map((entry) => this.resolveDepToken(entry, chain)));
  }

  private invalidateCachedEntry(token: Token, scope: Scope): void {
    if (this.requestCache.has(token)) {
      const cached = this.requestCache.get(token);

      if (cached) {
        this.staleCache.set(token, cached);
      }

      this.requestCache.delete(token);
    }

    if (this.parent || scope !== 'singleton') {
      return;
    }

    const singletonCache = this.singletonCache;

    if (singletonCache.has(token)) {
      const cached = singletonCache.get(token);

      if (cached) {
        this.staleCache.set(token, cached);
      }

      singletonCache.delete(token);
    }
  }
}
