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
  private readonly singletonCache: Map<Token, Promise<unknown>>;

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

      this.registrations.set(normalized.provide, normalized);
    }

    return this;
  }

  has(token: Token): boolean {
    return this.lookupProvider(token) !== undefined || this.hasMulti(token);
  }

  createRequestScope(): Container {
    return new Container(this, true, this.root().singletonCache);
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    return this.resolveWithChain(token, []);
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
    if (chain.includes(token)) {
      if (allowForwardRef) {
        // A forwardRef dep is in the chain — return the partially-initialized
        // instance from the singleton cache if it is already being constructed.
        const cache = this.singletonCacheFor(token);

        if (cache?.has(token)) {
          return (await cache.get(token)) as T;
        }
      }

      throw new CircularDependencyError([...chain, token]);
    }

    const multiProviders = this.collectMultiProviders(token);

    if (multiProviders.length > 0) {
      const instances = await Promise.all(
        multiProviders.map((p) => this.instantiate(p, [...chain, token])),
      );

      return instances as unknown as T;
    }

    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(`No provider registered for token ${String(token)}.`);
    }

    if (provider.type === 'existing') {
      const target = provider.useExisting!;

      return this.resolveWithChain(target as Token<T>, [...chain, token]);
    }

    if (provider.scope === 'transient') {
      return (await this.instantiate(provider, [...chain, token])) as T;
    }

    const cache = this.cacheFor(provider.scope, provider.provide);

    if (!cache.has(provider.provide)) {
      const promise = this.instantiate(provider, [...chain, token]);

      cache.set(provider.provide, promise);
      promise.catch(() => cache.delete(provider.provide));
    }

    return (await cache.get(provider.provide)) as T;
  }

  private singletonCacheFor(token: Token): Map<Token, Promise<unknown>> | undefined {
    const provider = this.lookupProvider(token);

    if (!provider || provider.scope !== 'singleton') return undefined;

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

  private cacheFor(scope: Scope, token: Token) {
    if (scope === 'singleton') {
      return this.root().singletonCache;
    }

    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${String(token)} cannot be resolved outside request scope.`,
      );
    }

    return this.requestCache;
  }

  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[]): Promise<T> {
    if (provider.scope === 'singleton') {
      for (const depEntry of provider.inject) {
        const depToken = isForwardRef(depEntry)
          ? depEntry.forwardRef()
          : isOptionalToken(depEntry)
            ? depEntry.token
            : (depEntry as Token);

        const depProvider = this.lookupProvider(depToken);

        if (depProvider?.scope === 'request') {
          throw new ScopeMismatchError(
            `Singleton provider ${String(provider.provide)} depends on request-scoped provider ${String(depToken)}. ` +
              'Singleton providers cannot depend on request-scoped providers.',
          );
        }
      }
    }

    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await Promise.all(provider.inject.map((entry) => this.resolveDepToken(entry, chain)));

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await Promise.all(provider.inject.map((entry) => this.resolveDepToken(entry, chain)));

        return new provider.useClass(...deps) as T;
      }
      default:
        throw new InvariantError('Unknown provider type.');
    }
  }
}
