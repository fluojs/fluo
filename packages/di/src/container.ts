import { InvariantError, type Token } from '@konekti/core';

import {
  ContainerResolutionError,
  InvalidProviderError,
  RequestScopeResolutionError,
} from './errors';
import type {
  ClassProvider,
  FactoryProvider,
  InjectableClass,
  NormalizedProvider,
  Provider,
  Scope,
  ValueProvider,
} from './types';

function isClassConstructor(value: Provider): value is InjectableClass {
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

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    return {
      inject: provider.inject ?? [],
      provide: provider,
      scope: 'singleton',
      type: 'class',
      useClass: provider,
    };
  }

  if (isValueProvider(provider)) {
    return {
      inject: [],
      provide: provider.provide,
      scope: 'singleton',
      type: 'value',
      useValue: provider.useValue,
    };
  }

  if (isFactoryProvider(provider)) {
    return {
      inject: provider.inject ?? [],
      provide: provider.provide,
      scope: provider.scope ?? 'singleton',
      type: 'factory',
      useFactory: provider.useFactory,
    };
  }

  if (isClassProvider(provider)) {
    return {
      inject: provider.inject ?? provider.useClass.inject ?? [],
      provide: provider.provide,
      scope: provider.scope ?? 'singleton',
      type: 'class',
      useClass: provider.useClass,
    };
  }

  throw new InvalidProviderError('Unsupported provider type.');
}

/**
 * Minimal explicit-token dependency injection container.
 */
export class Container {
  private readonly registrations = new Map<Token, NormalizedProvider>();
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

      this.registrations.set(normalized.provide, normalized);
    }

    return this;
  }

  has(token: Token): boolean {
    return this.lookupProvider(token) !== undefined;
  }

  /**
   * Creates a child container that owns request-scoped provider instances.
   */
  createRequestScope(): Container {
    return new Container(this, true, this.root().singletonCache);
  }

  /**
   * Resolves a token from the current container boundary.
   */
  async resolve<T>(token: Token<T>): Promise<T> {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(`No provider registered for token ${String(token)}.`);
    }

    const cache = this.cacheFor(provider.scope, provider.provide);

    if (!cache.has(provider.provide)) {
      cache.set(provider.provide, this.instantiate(provider));
    }

    return (await cache.get(provider.provide)) as T;
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

    // Request-scoped providers must never resolve from the root container.
    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${String(token)} cannot be resolved outside request scope.`,
      );
    }

    return this.requestCache;
  }

  private async instantiate<T>(provider: NormalizedProvider<T>): Promise<T> {
    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await Promise.all(provider.inject.map((token) => this.resolve(token)));

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await Promise.all(provider.inject.map((token) => this.resolve(token)));

        return new provider.useClass(...deps) as T;
      }
      default:
        throw new InvariantError('Unknown provider type.');
    }
  }
}
