import type { Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';

import { InvalidProviderError } from './errors.js';
import type { ClassType, ForwardRefFn, NormalizedProvider, OptionalToken, Provider } from './types.js';
import { Scope } from './types.js';

type ProviderObjectInput = {
  readonly inject?: unknown;
  readonly multi?: boolean;
  readonly provide?: Token | null;
  readonly resolverClass?: ClassType;
  readonly scope?: unknown;
  readonly useClass?: unknown;
  readonly useExisting?: Token | null;
  readonly useFactory?: unknown;
  readonly useValue?: unknown;
};

type ValidatedProviderObject = ProviderObjectInput & { readonly provide: Token };
type NormalizedInjectToken = Token | ForwardRefFn | OptionalToken;

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

function isTokenResolver(value: unknown): value is () => Token {
  return typeof value === 'function';
}

function isToken(value: unknown): value is Token {
  return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
}

function isScope(value: unknown): value is Scope {
  return value === 'singleton' || value === 'request' || value === 'transient';
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

function normalizeProviderScope(scope: unknown, providerToken: Token): Scope | undefined {
  if (scope === undefined) {
    return undefined;
  }

  if (isScope(scope)) {
    return scope;
  }

  throw new InvalidProviderError('Provider scope must be one of singleton, request, or transient.', {
    token: providerToken,
    scope: String(scope),
    hint: 'Use Scope.DEFAULT, Scope.REQUEST, Scope.TRANSIENT, or the matching string literal.',
  });
}

function normalizeInjectToken(token: unknown, providerToken: Token, index: number): NormalizedInjectToken {
  if (typeof token === 'object' && token !== null && '__forwardRef__' in token && token.__forwardRef__ === true) {
    if (!('forwardRef' in token) || !isTokenResolver(token.forwardRef)) {
      throw new InvalidProviderError(`Provider inject forwardRef wrapper at index ${String(index)} must expose a callable forwardRef function.`, {
        token: providerToken,
      });
    }

    return Object.freeze<ForwardRefFn>({
      __forwardRef__: true,
      forwardRef: token.forwardRef,
    });
  }

  if (typeof token === 'object' && token !== null && '__optional__' in token && token.__optional__ === true) {
    if (!('token' in token) || !isToken(token.token)) {
      throw new InvalidProviderError(`Provider inject optional wrapper at index ${String(index)} must contain a valid token.`, {
        token: providerToken,
      });
    }

    return Object.freeze<OptionalToken>({
      __optional__: true,
      token: token.token,
    });
  }

  if (isToken(token)) {
    return token;
  }

  throw new InvalidProviderError(`Provider inject entry at index ${String(index)} must be a string, symbol, class, forwardRef(), or optional() token wrapper.`, {
    token: providerToken,
    hint: 'Check that every dependency token is defined, and use forwardRef() for declaration-order cycles.',
  });
}

function normalizeInject(inject: unknown, providerToken: Token): readonly NormalizedInjectToken[] {
  if (inject === undefined) {
    return [];
  }

  if (!Array.isArray(inject)) {
    throw new InvalidProviderError('Provider inject must be an array.', {
      token: providerToken,
      hint: 'Pass dependency tokens as inject: [DependencyA, DependencyB].',
    });
  }

  return inject.map((token, index) => normalizeInjectToken(token, providerToken, index));
}

function freezeNormalizedProvider<T>(provider: NormalizedProvider<T>): NormalizedProvider<T> {
  return Object.freeze({
    ...provider,
    inject: Object.freeze([...provider.inject]),
  });
}

export function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return freezeNormalizedProvider({
      inject: normalizeInject(metadata?.inject, provider),
      provide: provider,
      scope: normalizeProviderScope(metadata?.scope, provider) ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    });
  }

  if (!isProviderObject(provider)) {
    throw new InvalidProviderError('Unsupported provider type.');
  }

  const objectProvider: ProviderObjectInput = provider;
  assertObjectProvider(objectProvider);
  const explicitScope = normalizeProviderScope(objectProvider.scope, objectProvider.provide);

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
      inject: normalizeInject(objectProvider.inject, objectProvider.provide),
      multi: objectProvider.multi,
      provide: objectProvider.provide,
      scope: explicitScope ?? normalizeProviderScope(metadata?.scope, objectProvider.provide) ?? Scope.DEFAULT,
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
      inject: normalizeInject(objectProvider.inject ?? metadata?.inject, objectProvider.provide),
      multi: objectProvider.multi,
      provide: objectProvider.provide,
      scope: explicitScope ?? normalizeProviderScope(metadata?.scope, objectProvider.provide) ?? Scope.DEFAULT,
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
