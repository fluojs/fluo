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
  Disposable,
  ForwardRefFn,
  NormalizedProvider,
  OptionalToken,
  Provider,
} from './types.js';
import { Scope, isForwardRef, isOptionalToken } from './types.js';

type ProviderObjectInput = {
  readonly inject?: readonly (Token | ForwardRefFn | OptionalToken)[];
  readonly multi?: boolean;
  readonly provide?: Token | null;
  readonly resolverClass?: ClassType;
  readonly scope?: Scope;
  readonly useClass?: unknown;
  readonly useExisting?: Token | null;
  readonly useFactory?: unknown;
  readonly useValue?: unknown;
};

type ValidatedProviderObject = ProviderObjectInput & { readonly provide: Token };

/**
 * Factory provider resolution mode recorded after a factory returns either synchronously or through a promise.
 */
export type FactoryResolutionKind = 'async' | 'sync';

interface CachedResolutionPlan<T> {
  readonly lineageRevision: string;
  readonly value: T;
}

/**
 * Controlled cache adoption seam for framework-owned testing and tooling that
 * need synchronous helpers to preserve container-owned singleton disposal.
 */
export interface ContainerResolutionCacheOwner {
  readonly deleteMultiSingleton: (provider: NormalizedProvider) => void;
  readonly deleteSingleton: (token: Token) => void;
  readonly recordFactoryResolution: (provider: NormalizedProvider, kind: FactoryResolutionKind) => void;
  readonly setMultiSingleton: (provider: NormalizedProvider, promise: Promise<unknown>) => void;
  readonly setSingleton: (token: Token, promise: Promise<unknown>) => void;
}

/**
 * Read-only factory resolution diagnostics recorded by container-owned factory
 * instantiation paths.
 */
export interface ContainerFactoryResolutionState {
  readonly get: (provider: NormalizedProvider) => FactoryResolutionKind | undefined;
  readonly has: (provider: NormalizedProvider) => boolean;
}

/**
 * Public read-only seam for framework-owned testing and tooling that need to
 * inspect a container's resolved provider graph without depending on private
 * field names or structural casts.
 */
export interface ContainerResolutionState {
  readonly cacheOwner: ContainerResolutionCacheOwner;
  readonly factoryResolutionKinds: ContainerFactoryResolutionState;
  readonly parent?: ContainerResolutionState;
  readonly registrations: ReadonlyMap<Token, NormalizedProvider>;
  readonly multiRegistrations: ReadonlyMap<Token, readonly NormalizedProvider[]>;
  readonly multiSingletonCache: ReadonlyMap<NormalizedProvider, Promise<unknown>>;
  readonly requestScopeEnabled: boolean;
  readonly singletonCache: ReadonlyMap<Token, Promise<unknown>>;
}

class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #source: ReadonlyMap<K, V>;

  readonly [Symbol.toStringTag] = 'Map';

  constructor(source: ReadonlyMap<K, V>) {
    this.#source = source;
  }

  get size(): number {
    return this.#source.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.#source.entries();
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#source) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  get(key: K): V | undefined {
    return this.#source.get(key);
  }

  has(key: K): boolean {
    return this.#source.has(key);
  }

  keys(): IterableIterator<K> {
    return this.#source.keys();
  }

  values(): IterableIterator<V> {
    return this.#source.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

class ReadonlyMultiRegistrationMapView implements ReadonlyMap<Token, readonly NormalizedProvider[]> {
  readonly #source: ReadonlyMap<Token, readonly NormalizedProvider[]>;

  readonly [Symbol.toStringTag] = 'Map';

  constructor(source: ReadonlyMap<Token, readonly NormalizedProvider[]>) {
    this.#source = source;
  }

  get size(): number {
    return this.#source.size;
  }

  *entries(): IterableIterator<[Token, readonly NormalizedProvider[]]> {
    for (const [token, providers] of this.#source) {
      yield [token, Object.freeze([...providers])];
    }
  }

  forEach(callbackfn: (value: readonly NormalizedProvider[], key: Token, map: ReadonlyMap<Token, readonly NormalizedProvider[]>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  get(key: Token): readonly NormalizedProvider[] | undefined {
    const providers = this.#source.get(key);
    return providers ? Object.freeze([...providers]) : undefined;
  }

  has(key: Token): boolean {
    return this.#source.has(key);
  }

  keys(): IterableIterator<Token> {
    return this.#source.keys();
  }

  *values(): IterableIterator<readonly NormalizedProvider[]> {
    for (const providers of this.#source.values()) {
      yield Object.freeze([...providers]);
    }
  }

  [Symbol.iterator](): IterableIterator<[Token, readonly NormalizedProvider[]]> {
    return this.entries();
  }
}

function isClassConstructor(value: Provider): value is ClassType {
  return typeof value === 'function';
}

function isProviderObject(value: unknown): value is ProviderObjectInput {
  return typeof value === 'object' && value !== null;
}

function isClassType(value: unknown): value is ClassType {
  return typeof value === 'function';
}

function isFactoryFunction(value: unknown): value is (...deps: unknown[]) => unknown {
  return typeof value === 'function';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function assertProviderToken(provider: ProviderObjectInput): asserts provider is ValidatedProviderObject {
  if (!('provide' in provider) || provider.provide == null) {
    throw new InvalidProviderError('Provider object must include a non-null provide token.');
  }
}

function assertProviderStrategy(provider: ProviderObjectInput): void {
  const strategyCount = Number('useValue' in provider) + Number('useFactory' in provider) + Number('useClass' in provider) + Number('useExisting' in provider);

  if (strategyCount !== 1) {
    throw new InvalidProviderError('Provider object must declare exactly one of useValue, useFactory, useClass, or useExisting.');
  }
}

function assertObjectProvider(provider: ProviderObjectInput): asserts provider is ValidatedProviderObject {
  assertProviderToken(provider);
  assertProviderStrategy(provider);
}

function normalizeInjectToken(token: Token | ForwardRefFn | OptionalToken): Token | ForwardRefFn | OptionalToken {
  if (token == null) {
    throw new InvalidProviderError('Inject token must not be null or undefined. Check that all tokens in @Inject(...) are defined at the point of decoration (forward-reference cycles require forwardRef()).');
  }

  if (isForwardRef(token)) {
    return Object.freeze<ForwardRefFn>({
      __forwardRef__: true,
      forwardRef: token.forwardRef,
    });
  }

  if (isOptionalToken(token)) {
    return Object.freeze<OptionalToken>({
      __optional__: true,
      token: token.token,
    });
  }

  return token;
}

function freezeNormalizedProvider<T>(provider: NormalizedProvider<T>): NormalizedProvider<T> {
  return Object.freeze({
    ...provider,
    inject: Object.freeze([...provider.inject]),
  });
}

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return freezeNormalizedProvider({
      inject: (metadata?.inject ?? []).map(normalizeInjectToken),
      provide: provider,
      scope: metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    });
  }

  if (!isProviderObject(provider)) {
    throw new InvalidProviderError('Unsupported provider type.');
  }

  const objectProvider: ProviderObjectInput = provider;
  assertObjectProvider(objectProvider);

  if ('useValue' in objectProvider) {
    return freezeNormalizedProvider({
      inject: [],
      multi: objectProvider.multi,
      provide: objectProvider.provide,
      scope: Scope.DEFAULT,
      type: 'value',
      useValue: objectProvider.useValue,
    });
  }

  if ('useFactory' in objectProvider) {
    if (!isFactoryFunction(objectProvider.useFactory)) {
      throw new InvalidProviderError('Factory provider useFactory must be a function.', { token: objectProvider.provide });
    }

    const metadata = objectProvider.resolverClass ? getClassDiMetadata(objectProvider.resolverClass) : undefined;

    return freezeNormalizedProvider({
      inject: (objectProvider.inject ?? []).map(normalizeInjectToken),
      multi: objectProvider.multi,
      provide: objectProvider.provide,
      scope: objectProvider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'factory',
      useFactory: objectProvider.useFactory,
    });
  }

  if ('useClass' in objectProvider) {
    if (!isClassType(objectProvider.useClass)) {
      throw new InvalidProviderError('Class provider useClass must be a constructor.', { token: objectProvider.provide });
    }

    const metadata = getClassDiMetadata(objectProvider.useClass);

    return freezeNormalizedProvider({
      inject: (objectProvider.inject ?? metadata?.inject ?? []).map(normalizeInjectToken),
      multi: objectProvider.multi,
      provide: objectProvider.provide,
      scope: objectProvider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: objectProvider.useClass,
    });
  }

  if ('useExisting' in objectProvider) {
    if (objectProvider.useExisting == null) {
      throw new InvalidProviderError('Alias provider useExisting must be a non-null token.', { token: objectProvider.provide });
    }

    return freezeNormalizedProvider({
      inject: [],
      provide: objectProvider.provide,
      scope: Scope.DEFAULT,
      type: 'existing',
      useExisting: objectProvider.useExisting,
    });
  }

  throw new InvalidProviderError('Provider object must declare exactly one of useValue, useFactory, useClass, or useExisting.');
}

/**
 * Scope-aware dependency injection container for Fluo providers.
 */
export class Container {
  private readonly registrations = new Map<Token, NormalizedProvider>();
  private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
  private readonly multiOverriddenTokens = new Set<Token>();
  private requestCache: Map<Token, Promise<unknown>> | undefined;
  private multiRequestCache: Map<NormalizedProvider, Promise<unknown>> | undefined;
  private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
  private readonly staleDisposalTasks = new Set<Promise<void>>();
  private readonly staleDisposalErrors: unknown[] = [];
  private readonly singletonCache: Map<Token, Promise<unknown>>;
  private readonly forwardRefTokenCache = new WeakMap<ForwardRefFn, Token>();
  private readonly factoryResolutionKinds = new WeakMap<NormalizedProvider, FactoryResolutionKind>();
  private readonly providerLookupPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
  private readonly multiProviderPlanCache = new Map<Token, CachedResolutionPlan<readonly NormalizedProvider[]>>();
  private readonly requestScopeVerdictPlanCache = new Map<Token, CachedResolutionPlan<boolean>>();
  private readonly effectiveProviderPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
  private childScopes: Set<Container> | undefined;
  private disposePromise: Promise<void> | undefined;
  private disposed = false;
  private trackedByParent = false;
  private graphRevision = 0;

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
    if (this.isDisposedInHierarchy()) {
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
          this.advanceGraphRevision();
          continue;
        }

        this.multiRegistrations.set(normalized.provide, [normalized]);
      } else {
        this.registrations.set(normalized.provide, normalized);
      }

      this.advanceGraphRevision();
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
    if (this.isDisposedInHierarchy()) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer override providers.',
        { hint: 'Ensure overrides are applied before calling container.dispose().' },
      );
    }

    const normalizedByToken = new Map<Token, NormalizedProvider[]>();

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const normalizedProviders = normalizedByToken.get(normalized.provide);

      if (normalizedProviders) {
        normalizedProviders.push(normalized);
        continue;
      }

      normalizedByToken.set(normalized.provide, [normalized]);
    }

    for (const [token, normalizedProviders] of normalizedByToken) {
      const firstProvider = normalizedProviders[0];

      if (!firstProvider) {
        continue;
      }

      const containsMultiProvider = normalizedProviders.some((normalized) => normalized.multi === true);

      if (containsMultiProvider && normalizedProviders.some((normalized) => normalized.multi !== true)) {
        throw new DuplicateProviderError(token);
      }

      if (!containsMultiProvider && normalizedProviders.length > 1) {
        throw new DuplicateProviderError(token);
      }

      this.invalidateAffectedCachedEntriesInHierarchy(token);
      this.registrations.delete(token);
      this.multiRegistrations.delete(token);

      if (containsMultiProvider) {
        this.multiRegistrations.set(token, normalizedProviders);
        this.multiOverriddenTokens.add(token);
        this.advanceGraphRevision();
        continue;
      }

      this.multiOverriddenTokens.add(token);
      this.registrations.set(token, firstProvider);
      this.advanceGraphRevision();
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
   * Returns the framework-owned resolution state for testing/tooling adapters.
   *
   * This method is the supported introspection seam for packages such as
   * `@fluojs/testing`; callers should prefer ordinary `has(...)` and
   * `resolve(...)` unless they need read-only graph/cache visibility while
   * implementing a framework-level helper. Cache adoption for synchronous
   * helpers goes through `cacheOwner`; the returned maps are not mutable
   * container internals.
   *
   * @returns Read-only provider registrations and resolution caches for this container scope.
   */
  inspectResolutionState(): ContainerResolutionState {
    const registrations = new Map(this.registrations);
    const multiRegistrations = new Map(
      Array.from(this.multiRegistrations, ([token, providers]) => [token, Object.freeze([...providers])] as const),
    );
    const multiSingletonCache = new Map(this.multiSingletonCache);
    const singletonCache = new Map(this.singletonCache);

    return {
      cacheOwner: this.createCacheOwner(singletonCache, multiSingletonCache),
      factoryResolutionKinds: this.createFactoryResolutionState(),
      parent: this.parent?.inspectResolutionState(),
      registrations: new ReadonlyMapView(registrations),
      multiRegistrations: new ReadonlyMultiRegistrationMapView(multiRegistrations),
      multiSingletonCache: new ReadonlyMapView(multiSingletonCache),
      requestScopeEnabled: this.requestScopeEnabled,
      singletonCache: new ReadonlyMapView(singletonCache),
    };
  }

  private createCacheOwner(
    singletonCacheSnapshot: Map<Token, Promise<unknown>>,
    multiSingletonCacheSnapshot: Map<NormalizedProvider, Promise<unknown>>,
  ): ContainerResolutionCacheOwner {
    return Object.freeze({
      deleteMultiSingleton: (provider: NormalizedProvider) => {
        this.multiSingletonCache.delete(provider);
        multiSingletonCacheSnapshot.delete(provider);
      },
      deleteSingleton: (token: Token) => {
        this.singletonCache.delete(token);
        singletonCacheSnapshot.delete(token);
      },
      recordFactoryResolution: (provider: NormalizedProvider, kind: FactoryResolutionKind) => {
        this.root().factoryResolutionKinds.set(provider, kind);
      },
      setMultiSingleton: (provider: NormalizedProvider, promise: Promise<unknown>) => {
        this.multiSingletonCache.set(provider, promise);
        multiSingletonCacheSnapshot.set(provider, promise);
      },
      setSingleton: (token: Token, promise: Promise<unknown>) => {
        this.singletonCache.set(token, promise);
        singletonCacheSnapshot.set(token, promise);
      },
    });
  }

  private createFactoryResolutionState(): ContainerFactoryResolutionState {
    const root = this.root();

    return Object.freeze({
      get: (provider: NormalizedProvider) => root.factoryResolutionKinds.get(provider),
      has: (provider: NormalizedProvider) => root.factoryResolutionKinds.has(provider),
    });
  }

  /**
   * Returns whether resolving a token may require a request-scope container.
   *
   * @param token Provider token to inspect through aliases, multi providers, and dependencies.
   * @returns `true` when the provider graph contains request-scoped dependencies or is cyclic.
   */
  hasRequestScopedDependency(token: Token): boolean {
    const cached = this.readCachedPlan(this.requestScopeVerdictPlanCache, token);

    if (cached) {
      return cached.value;
    }

    return this.writePlanCache(
      this.requestScopeVerdictPlanCache,
      token,
      this.providerGraphRequiresRequestScope(token, new Set<Token>()),
    );
  }

  /**
   * Creates a child request-scope container that shares root singleton cache.
   *
   * @returns A request-scope child container bound to this container hierarchy.
   * @throws {ContainerResolutionError} When called after the container was disposed.
   */
  createRequestScope(): Container {
    if (this.isDisposedInHierarchy()) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer create request scopes.',
        { hint: 'Create request scopes before calling container.dispose().' },
      );
    }

    return new Container(this, true, this.root().singletonCache);
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
    if (this.isDisposedInHierarchy()) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer resolve providers.',
        { token, hint: 'Ensure all resolves complete before calling container.dispose().' },
      );
    }

    await this.assertStaleDisposalsSettled();

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
    this.advanceGraphRevision();
    this.disposePromise = this.disposeAll();

    try {
      await this.disposePromise;
    } catch (error) {
      this.disposePromise = undefined;
      throw error;
    }
  }

  private async disposeAll(): Promise<void> {
    const errors: unknown[] = [];

    try {
      // Dispose all live request-scope children before tearing down this scope's cache.
      if (this.childScopes && this.childScopes.size > 0) {
        const childResults = await Promise.allSettled(Array.from(this.childScopes).map((child) => child.dispose()));

        for (const result of childResults) {
          if (result.status === 'rejected') {
            this.collectDisposalError(result.reason, errors);
          }
        }

        this.childScopes.clear();
      }

      try {
        await this.disposeCache(this.disposalCacheEntries());
      } catch (error) {
        this.collectDisposalError(error, errors);
      }

      this.throwDisposalErrors(errors);
    } finally {
      if (this.parent && this.trackedByParent) {
        this.parent.childScopes?.delete(this);
        this.trackedByParent = false;
      }
    }
  }

  private isDisposedInHierarchy(): boolean {
    if (this.disposed) {
      return true;
    }

    return this.parent?.isDisposedInHierarchy() ?? false;
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
    const cached = this.readCachedPlan(this.multiProviderPlanCache, token);

    if (cached) {
      return [...cached.value];
    }

    const local = this.multiRegistrations.get(token);
    let providers: readonly NormalizedProvider[];

    if (this.multiOverriddenTokens.has(token)) {
      providers = Object.freeze([...(local ?? [])]);
    } else {
      const fromParent = this.parent ? this.parent.collectMultiProviders(token) : [];

      providers = Object.freeze(local ? [...fromParent, ...local] : [...fromParent]);
    }

    this.writePlanCache(this.multiProviderPlanCache, token, providers);
    return [...providers];
  }

  private providerGraphRequiresRequestScope(token: Token, visited: Set<Token>): boolean {
    if (visited.has(token)) {
      return true;
    }

    visited.add(token);

    try {
      const provider = this.lookupProvider(token);
      const multiProviders = this.collectMultiProviders(token);

      if (!provider && multiProviders.length === 0) {
        return this.unregisteredClassRequiresRequestScope(token, visited);
      }

      if (provider && this.normalizedProviderRequiresRequestScope(provider, visited)) {
        return true;
      }

      return multiProviders.some((multiProvider) => this.normalizedProviderRequiresRequestScope(multiProvider, visited));
    } finally {
      visited.delete(token);
    }
  }

  private unregisteredClassRequiresRequestScope(token: Token, visited: Set<Token>): boolean {
    if (typeof token !== 'function') {
      return false;
    }

    const metadata = getClassDiMetadata(token);

    if (metadata?.scope === Scope.REQUEST) {
      return true;
    }

    return (metadata?.inject ?? []).some((depEntry: Token | ForwardRefFn | OptionalToken) => this.dependencyEntryRequiresRequestScope(depEntry, visited));
  }

  private normalizedProviderRequiresRequestScope(provider: NormalizedProvider, visited: Set<Token>): boolean {
    if (provider.scope === Scope.REQUEST) {
      return true;
    }

    if (provider.type === 'existing' && provider.useExisting !== undefined) {
      return this.providerGraphRequiresRequestScope(provider.useExisting, visited);
    }

    return provider.inject.some((depEntry) => this.dependencyEntryRequiresRequestScope(depEntry, visited));
  }

  private dependencyEntryRequiresRequestScope(
    depEntry: Token | ForwardRefFn | OptionalToken,
    visited: Set<Token>,
  ): boolean {
    const depToken = this.resolveProviderDependencyToken(depEntry);

    if (isOptionalToken(depEntry) && !this.has(depToken)) {
      return false;
    }

    return this.providerGraphRequiresRequestScope(depToken, visited);
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

  private ensureTrackedRequestScope(): void {
    if (!this.requestScopeEnabled || !this.parent || this.trackedByParent) {
      return;
    }

    this.parent.ensureTrackedRequestScope();
    this.parent.childScopes ??= new Set<Container>();
    this.parent.childScopes.add(this);
    this.trackedByParent = true;
  }

  private requestCacheForWrite(): Map<Token, Promise<unknown>> {
    this.ensureTrackedRequestScope();
    this.requestCache ??= new Map<Token, Promise<unknown>>();
    return this.requestCache;
  }

  private multiRequestCacheForWrite(): Map<NormalizedProvider, Promise<unknown>> {
    this.ensureTrackedRequestScope();
    this.multiRequestCache ??= new Map<NormalizedProvider, Promise<unknown>>();
    return this.multiRequestCache;
  }

  private lookupProvider(token: Token): NormalizedProvider | undefined {
    const cached = this.readCachedPlan(this.providerLookupPlanCache, token);

    if (cached) {
      return cached.value;
    }

    const local = this.registrations.get(token);
    const provider = local ?? this.parent?.lookupProvider(token);

    return this.writePlanCache(this.providerLookupPlanCache, token, provider);
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
        return this.requestCacheForWrite();
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

    return this.requestCacheForWrite();
  }

  private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
        return this.multiRequestCacheForWrite();
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

    return this.multiRequestCacheForWrite();
  }

  private hasLocalMultiProvider(provider: NormalizedProvider): boolean {
    return this.multiRegistrations.get(provider.provide)?.includes(provider) ?? false;
  }

  private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
    if (this.parent) {
      const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.requestCache?.entries() ?? []);

      for (const [provider, promise] of this.multiRequestCache?.entries() ?? []) {
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
      this.requestCache?.clear();
      this.multiRequestCache?.clear();
      this.clearResolutionPlanCaches();
      return;
    }

    this.singletonCache.clear();
    this.multiSingletonCache.clear();
    this.clearResolutionPlanCaches();
  }

  private currentLineageRevision(): string {
    const parentRevision = this.parent?.currentLineageRevision();

    return parentRevision ? `${parentRevision}/${this.graphRevision}` : String(this.graphRevision);
  }

  private readCachedPlan<T>(cache: Map<Token, CachedResolutionPlan<T>>, token: Token): CachedResolutionPlan<T> | undefined {
    const cached = cache.get(token);

    if (!cached || cached.lineageRevision !== this.currentLineageRevision()) {
      return undefined;
    }

    return cached;
  }

  private writePlanCache<T>(cache: Map<Token, CachedResolutionPlan<T>>, token: Token, value: T): T {
    cache.set(token, {
      lineageRevision: this.currentLineageRevision(),
      value,
    });

    return value;
  }

  private advanceGraphRevision(): void {
    this.graphRevision += 1;
    this.clearResolutionPlanCaches();
  }

  private clearResolutionPlanCaches(): void {
    this.providerLookupPlanCache.clear();
    this.multiProviderPlanCache.clear();
    this.requestScopeVerdictPlanCache.clear();
    this.effectiveProviderPlanCache.clear();
  }

  private async waitForStaleDisposalTasks(): Promise<void> {
    while (this.staleDisposalTasks.size > 0) {
      await Promise.all(Array.from(this.staleDisposalTasks));
    }
  }

  private async assertStaleDisposalsSettled(): Promise<void> {
    const errors: unknown[] = [];

    await this.collectStaleDisposalErrorsInHierarchy(errors);
    this.throwDisposalErrors(errors);
  }

  private async collectStaleDisposalErrorsInHierarchy(errors: unknown[]): Promise<void> {
    await this.waitForStaleDisposalTasks();

    errors.push(...this.staleDisposalErrors.splice(0, this.staleDisposalErrors.length));

    for (const childScope of this.childScopes ?? []) {
      await childScope.collectStaleDisposalErrorsInHierarchy(errors);
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

  private collectDisposalError(error: unknown, errors: unknown[]): void {
    if (error instanceof AggregateError) {
      errors.push(...error.errors);
      return;
    }

    errors.push(error);
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
        const value = provider.useFactory(...deps);
        this.root().factoryResolutionKinds.set(provider, isPromiseLike(value) ? 'async' : 'sync');

        return value as T;
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

    const requestScopedDependency = this.findRequestScopedDependency(provider.inject, new Set<Token>([provider.provide]));

    if (requestScopedDependency) {
      throw new ScopeMismatchError(
        `Singleton provider ${formatTokenName(provider.provide)} depends on request-scoped provider ${formatTokenName(requestScopedDependency)}.`,
        {
          token: provider.provide,
          scope: 'singleton',
          hint: `Singleton providers cannot depend on request-scoped providers. Either change ${formatTokenName(requestScopedDependency)} to singleton/transient scope, or change ${formatTokenName(provider.provide)} to request scope.`,
        },
      );
    }
  }

  private findRequestScopedDependency(
    depEntries: readonly (Token | ForwardRefFn | OptionalToken)[],
    visited: Set<Token>,
  ): Token | undefined {
    for (const depEntry of depEntries) {
      const depToken = this.resolveProviderDependencyToken(depEntry);

      if (isOptionalToken(depEntry) && !this.has(depToken)) {
        continue;
      }

      const requestScopedToken = this.findRequestScopedDependencyToken(depToken, visited);

      if (requestScopedToken) {
        return requestScopedToken;
      }
    }

    return undefined;
  }

  private findRequestScopedDependencyToken(token: Token, visited: Set<Token>): Token | undefined {
    if (visited.has(token)) {
      return undefined;
    }

    visited.add(token);

    try {
      const provider = this.resolveEffectiveProvider(token);

      if (provider) {
        if (provider.scope === Scope.REQUEST) {
          return provider.provide;
        }

        return this.findRequestScopedDependency(provider.inject, visited);
      }

      if (typeof token !== 'function') {
        return undefined;
      }

      const metadata = getClassDiMetadata(token);

      if (metadata?.scope === Scope.REQUEST) {
        return token;
      }

      return this.findRequestScopedDependency(metadata?.inject ?? [], visited);
    } finally {
      visited.delete(token);
    }
  }

  private resolveEffectiveProvider(
    token: Token,
    visited = new Set<Token>(),
    chain: Token[] = [],
  ): NormalizedProvider | undefined {
    const cacheable = visited.size === 0 && chain.length === 0;

    if (cacheable) {
      const cached = this.readCachedPlan(this.effectiveProviderPlanCache, token);

      if (cached) {
        return cached.value;
      }
    }

    let currentToken = token;

    while (true) {
      if (visited.has(currentToken)) {
        throw new CircularDependencyError([...chain, currentToken]);
      }

      visited.add(currentToken);

      const provider = this.lookupProvider(currentToken);

      if (!provider) {
        if (cacheable) {
          return this.writePlanCache(this.effectiveProviderPlanCache, token, undefined);
        }

        return undefined;
      }

      if (provider.type !== 'existing' || provider.useExisting === undefined) {
        if (cacheable) {
          return this.writePlanCache(this.effectiveProviderPlanCache, token, provider);
        }

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

  private invalidateAffectedCachedEntriesInHierarchy(token: Token): void {
    this.invalidateAffectedCachedEntries(token);

    for (const childScope of this.childScopes ?? []) {
      childScope.invalidateAffectedCachedEntriesInHierarchy(token);
    }
  }

  private invalidateAffectedCachedEntries(token: Token): void {
    for (const [cachedToken, cached] of this.requestCache?.entries() ?? []) {
      if (!this.shouldInvalidateCachedToken(cachedToken, token)) {
        continue;
      }

      this.scheduleStaleDisposal(cached);
      this.requestCache?.delete(cachedToken);
    }

    if (!this.parent) {
      for (const [cachedToken, cached] of this.singletonCache.entries()) {
        if (!this.shouldInvalidateCachedToken(cachedToken, token)) {
          continue;
        }

        this.scheduleStaleDisposal(cached);
        this.singletonCache.delete(cachedToken);
      }
    }

    if (!this.parent) {
      for (const [provider, cached] of this.multiSingletonCache.entries()) {
        if (!this.shouldInvalidateCachedProvider(provider, token)) {
          continue;
        }

        this.scheduleStaleDisposal(cached);
        this.multiSingletonCache.delete(provider);
      }
    }

    const multiRequestCache = this.multiRequestCache;

    if (!multiRequestCache) {
      return;
    }

    for (const [provider, cached] of multiRequestCache.entries()) {
      if (!this.shouldInvalidateCachedProvider(provider, token)) {
        continue;
      }

      this.scheduleStaleDisposal(cached);
      multiRequestCache.delete(provider);
    }
  }

  private shouldInvalidateCachedToken(cachedToken: Token, overriddenToken: Token): boolean {
    if (cachedToken === overriddenToken) {
      return true;
    }

    const provider = this.lookupProvider(cachedToken);
    const multiProviders = this.collectMultiProviders(cachedToken);

    if (provider && this.providerDependsOnToken(provider, overriddenToken, new Set<Token>([provider.provide]))) {
      return true;
    }

    return multiProviders.some((multiProvider) =>
      this.providerDependsOnToken(multiProvider, overriddenToken, new Set<Token>([multiProvider.provide])),
    );
  }

  private shouldInvalidateCachedProvider(provider: NormalizedProvider, overriddenToken: Token): boolean {
    return provider.provide === overriddenToken || this.providerDependsOnToken(provider, overriddenToken, new Set<Token>([provider.provide]));
  }

  private providerDependsOnToken(provider: NormalizedProvider, token: Token, visited: Set<Token>): boolean {
    if (provider.type === 'existing' && provider.useExisting !== undefined) {
      return this.dependencyTokenReferencesToken(provider.useExisting, token, visited);
    }

    return provider.inject.some((depEntry) => this.dependencyEntryReferencesToken(depEntry, token, visited));
  }

  private dependencyEntryReferencesToken(depEntry: Token | ForwardRefFn | OptionalToken, token: Token, visited: Set<Token>): boolean {
    return this.dependencyTokenReferencesToken(this.resolveProviderDependencyToken(depEntry), token, visited);
  }

  private dependencyTokenReferencesToken(depToken: Token, token: Token, visited: Set<Token>): boolean {
    if (depToken === token) {
      return true;
    }

    if (visited.has(depToken)) {
      return false;
    }

    visited.add(depToken);

    try {
      const provider = this.lookupProvider(depToken);
      const multiProviders = this.collectMultiProviders(depToken);

      return (
        (provider ? this.providerDependsOnToken(provider, token, visited) : false) ||
        multiProviders.some((multiProvider) => this.providerDependsOnToken(multiProvider, token, visited))
      );
    } finally {
      visited.delete(depToken);
    }
  }
}
