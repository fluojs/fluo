import { InvariantError, getClassDiMetadata, type Token } from '@konekti/core';

import {
  CircularDependencyError,
  ContainerResolutionError,
  InvalidProviderError,
  RequestScopeResolutionError,
} from './errors.js';
import type {
  ClassType,
  ClassProvider,
  FactoryProvider,
  NormalizedProvider,
  Provider,
  Scope,
  ValueProvider,
} from './types.js';

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

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return {
      inject: metadata?.inject ?? [],
      provide: provider,
      scope: metadata?.scope ?? 'singleton',
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
    const metadata = getClassDiMetadata(provider.useClass);

    return {
      inject: provider.inject ?? metadata?.inject ?? [],
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? 'singleton',
      type: 'class',
      useClass: provider.useClass,
    };
  }

  throw new InvalidProviderError('Unsupported provider type.');
}

/**
 * 명시적 토큰 기반 DI를 처리하는 최소 컨테이너 구현이다.
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

  /**
   * 하나 이상의 provider를 현재 컨테이너 경계에 등록한다.
   */
  register(...providers: Provider[]): this {
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      this.registrations.set(normalized.provide, normalized);
    }

    return this;
  }

  /**
   * 현재 컨테이너나 상위 컨테이너에서 토큰을 해석할 수 있는지 확인한다.
   */
  has(token: Token): boolean {
    return this.lookupProvider(token) !== undefined;
  }

  /**
   * 요청 스코프 전용 provider 인스턴스를 소유하는 자식 컨테이너를 만든다.
   */
  createRequestScope(): Container {
    return new Container(this, true, this.root().singletonCache);
  }

  /**
   * 현재 컨테이너 경계에서 토큰을 해석하고 scope 규칙에 따라 캐시한다.
   */
  async resolve<T>(token: Token<T>): Promise<T> {
    return this.resolveWithChain(token, []);
  }

  private async resolveWithChain<T>(token: Token<T>, chain: Token[]): Promise<T> {
    if (chain.includes(token)) {
      throw new CircularDependencyError([...chain, token]);
    }

    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(`No provider registered for token ${String(token)}.`);
    }

    const cache = this.cacheFor(provider.scope, provider.provide);

    if (!cache.has(provider.provide)) {
      const promise = this.instantiate(provider, [...chain, token]);

      cache.set(provider.provide, promise);
      promise.catch(() => cache.delete(provider.provide));
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

  /**
   * scope에 맞는 캐시 저장소를 반환하고, 잘못된 request-scope 접근을 차단한다.
   */
  private cacheFor(scope: Scope, token: Token) {
    if (scope === 'singleton') {
      return this.root().singletonCache;
    }

    // request-scope provider는 루트 컨테이너에서 직접 resolve되면 안 된다.
    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${String(token)} cannot be resolved outside request scope.`,
      );
    }

    return this.requestCache;
  }

  /**
   * 정규화된 provider 정의를 실제 인스턴스나 값으로 구체화한다.
   */
  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[]): Promise<T> {
    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await Promise.all(provider.inject.map((token) => this.resolveWithChain(token, chain)));

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await Promise.all(provider.inject.map((token) => this.resolveWithChain(token, chain)));

        return new provider.useClass(...deps) as T;
      }
      default:
        throw new InvariantError('Unknown provider type.');
    }
  }
}
