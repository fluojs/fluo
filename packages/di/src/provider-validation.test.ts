import { Inject, Scope } from '@fluojs/core';
import { describe, expect, it, vi } from 'vitest';

import { Container } from './container.js';
import { CircularDependencyError, DuplicateProviderError, InvalidProviderError, RequestScopeResolutionError, ScopeMismatchError } from './errors.js';
import { validateProviderInputs } from './internal.js';
import type { Provider } from './types.js';

function captureRegistrationError(provider: unknown): InvalidProviderError {
  const container = new Container();

  try {
    Reflect.apply(container.register, container, [provider]);
  } catch (error) {
    if (error instanceof InvalidProviderError) {
      return error;
    }

    throw error;
  }

  expect.unreachable('expected malformed provider registration to fail');
}

describe('provider input validation', () => {
  it.each([
    ['a number', 1],
    ['a plain object', {}],
    ['a non-constructable function', () => undefined],
  ])('rejects %s as a provide token', (_kind, provide) => {
    // Given
    const provider = { provide, useValue: 'ready' };

    // When
    const error = captureRegistrationError(provider);

    // Then
    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('provide token'));
  });

  it.each([
    ['a number', 1],
    ['a plain object', {}],
    ['a non-constructable function', () => undefined],
  ])('rejects %s as a useExisting token', (_kind, useExisting) => {
    // Given
    const provider = { provide: Symbol('alias'), useExisting };

    // When
    const error = captureRegistrationError(provider);

    // Then
    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('useExisting'));
  });

  it.each([
    ['a string', 'service'],
    ['a symbol', Symbol('service')],
    ['a constructable class', class Service {}],
  ])('accepts %s token for provide and useExisting', (_kind, token) => {
    // Given
    const alias = Symbol('alias');
    const container = new Container();

    // When
    const register = () => container.register(
      { provide: token, useValue: 'ready' },
      { provide: alias, useExisting: token },
    );

    // Then
    expect(register).not.toThrow();
  });

  it.each([
    ['an empty array', []],
    ['undefined', undefined],
  ])('rejects a value provider when inject is declared as %s', (_kind, inject) => {
    // Given
    const provider = {
      provide: Symbol('value-with-inject'),
      useValue: 'ready',
      inject,
    };

    // When
    const error = captureRegistrationError(provider);

    // Then
    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
  });

  it.each([
    ['factory', { provide: Symbol('factory'), useFactory: () => undefined, inject: 'dependency' }],
    ['class', { provide: Symbol('class'), useClass: class Service {}, inject: { token: 'dependency' } }],
  ])('normalizes a non-array %s provider inject value to InvalidProviderError', (_kind, provider) => {
    const error = captureRegistrationError(provider);

    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('inject must be an array'));
  });

  it('normalizes an explicit null useClass provider inject value to InvalidProviderError', () => {
    const provider = {
      provide: Symbol('class-with-null-inject'),
      useClass: class Service {},
      inject: null,
    };

    const error = captureRegistrationError(provider);

    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('inject must be an array'));
  });

  it('falls back to decorated useClass inject metadata when inject is explicitly undefined', async () => {
    class Dependency {}

    @Inject(Dependency)
    class Service {
      constructor(readonly dependency: Dependency) {}
    }

    const container = new Container().register(
      Dependency,
      { provide: Service, useClass: Service, inject: undefined },
    );

    const service = await container.resolve(Service);

    expect(service.dependency).toBeInstanceOf(Dependency);
  });

  it('normalizes a non-constructable function inject token to InvalidProviderError', () => {
    const provider = {
      provide: Symbol('consumer-with-arrow-token'),
      useFactory: () => undefined,
      inject: [() => undefined],
    };

    const error = captureRegistrationError(provider);

    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('inject'));
  });

  it.each([
    ['null token', null],
    ['undefined token', undefined],
    ['plain object', {}],
    ['malformed forwardRef wrapper', { __forwardRef__: true, forwardRef: 'Service' }],
    ['malformed optional wrapper', { __optional__: true, token: {} }],
  ])('normalizes a %s inject entry to InvalidProviderError', (_kind, dependency) => {
    const provider = {
      provide: Symbol('consumer'),
      useFactory: () => undefined,
      inject: [dependency],
    };

    const error = captureRegistrationError(provider);

    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
    expect(error).toHaveProperty('message', expect.stringContaining('inject'));
  });

  it.each([
    ['unknown string', 'session'],
    ['null', null],
    ['number', 1],
  ])('normalizes an invalid %s provider scope to InvalidProviderError', (_kind, scope) => {
    const token = Symbol('scoped-provider');
    const provider = { provide: token, useFactory: () => undefined, scope };

    const error = captureRegistrationError(provider);

    expect(error).toBeInstanceOf(InvalidProviderError);
    expect(error).toMatchObject({
      code: 'INVALID_PROVIDER',
      meta: { scope: String(scope), token: token.toString() },
    });
    expect(error).toHaveProperty('message', expect.stringContaining('scope'));
  });

  it.each([
    ['value', { useValue: 'ready' }],
    ['factory', { useFactory: () => 'ready' }],
    ['class', { useClass: class Service {} }],
    ['alias', { useExisting: 'target' }],
  ])('rejects a non-boolean multi flag on a %s provider', (_kind, strategy) => {
    for (const multi of ['yes', 1, 0, null, {}]) {
      const token = Symbol('multi-flag');

      const error = captureRegistrationError({ provide: token, ...strategy, multi });

      expect(error).toMatchObject({ code: 'INVALID_PROVIDER', meta: { token: token.toString() } });
      expect(error).toHaveProperty('message', expect.stringContaining('multi'));
    }
  });

  it('keeps multi: false as a single registration for conflict checks and storage', async () => {
    const token = Symbol('single');
    const container = new Container().register({ provide: token, useValue: 'one', multi: false });

    expect(() => container.register({ provide: token, useValue: 'two', multi: true })).toThrow(DuplicateProviderError);
    await expect(container.resolve(token)).resolves.toBe('one');
  });

  it('does not let a rejected truthy multi flag change existing single registrations', async () => {
    const token = Symbol('single');
    const container = new Container().register({ provide: token, useValue: 'one' });

    expect(() => Reflect.apply(container.register, container, [{ provide: token, useValue: 'two', multi: 'yes' }])).toThrow(
      InvalidProviderError,
    );
    await expect(container.resolve(token)).resolves.toBe('one');
  });

  it.each([
    ['a string', 'Resolver'],
    ['a number', 1],
    ['null', null],
    ['a plain object', {}],
    ['a non-constructable function', () => undefined],
  ])('rejects %s resolverClass with InvalidProviderError', (_kind, resolverClass) => {
    const token = Symbol('factory-with-resolver');

    const error = captureRegistrationError({ provide: token, useFactory: () => 'ready', resolverClass });

    expect(error).toMatchObject({ code: 'INVALID_PROVIDER', meta: { token: token.toString() } });
    expect(error).toHaveProperty('message', expect.stringContaining('resolverClass'));
  });

  it('still inherits scope metadata from a constructable resolverClass and ignores an explicit undefined one', async () => {
    @Scope('transient')
    class TransientResolver {}

    const transientToken = Symbol('transient-factory');
    const defaultToken = Symbol('default-factory');
    const container = new Container().register(
      { provide: transientToken, useFactory: () => ({}), resolverClass: TransientResolver },
      { provide: defaultToken, useFactory: () => ({}), resolverClass: undefined },
    );

    expect(await container.resolve(transientToken)).not.toBe(await container.resolve(transientToken));
    expect(await container.resolve(defaultToken)).toBe(await container.resolve(defaultToken));
  });

  it.each([
    ['string', 'S'],
    ['symbol', Symbol('S')],
    ['class', class SelfAliased {}],
  ])('rejects a direct %s self-alias at registration', (_kind, token) => {
    for (const multi of [undefined, true]) {
      const error = captureRegistrationError({ provide: token, useExisting: token, multi });

      expect(error).toMatchObject({ code: 'INVALID_PROVIDER' });
      expect(error).toHaveProperty('message', expect.stringContaining('itself'));
    }
  });

  it('rejects the new provider inputs through override() and validateProviderInputs() without mutating state', async () => {
    const token = Symbol('override-target');
    const container = new Container().register({ provide: token, useValue: 'original' });
    const invalidProviders = [
      { provide: token, useValue: 'next', multi: 'yes' },
      { provide: token, useFactory: () => 'next', resolverClass: 'Resolver' },
      { provide: token, useExisting: token },
    ] as unknown as Provider[];

    for (const provider of invalidProviders) {
      expect(() => container.override(provider)).toThrow(InvalidProviderError);
      expect(() => validateProviderInputs([provider])).toThrow(InvalidProviderError);
    }

    await expect(container.resolve(token)).resolves.toBe('original');
  });
});

describe('value and alias provider scopes', () => {
  function disposableValue() {
    return { onDestroy: vi.fn() };
  }

  it('keeps singleton as the default value provider scope and owns its disposal', async () => {
    const token = Symbol('singleton-value');
    const value = disposableValue();
    const container = new Container().register({ provide: token, useValue: value });

    await container.resolve(token);
    await container.dispose();

    expect(value.onDestroy).toHaveBeenCalledTimes(1);
  });

  it('resolves a transient value provider per call without caching or owning it', async () => {
    const token = Symbol('transient-value');
    const value = disposableValue();
    const container = new Container().register({ provide: token, useValue: value, scope: 'transient' });

    await expect(container.resolve(token)).resolves.toBe(value);
    expect(container.inspectResolutionState().singletonCache.has(token)).toBe(false);

    await container.dispose();

    expect(value.onDestroy).not.toHaveBeenCalled();
  });

  it('lets a request scope register value and alias providers with scope: request', async () => {
    const root = new Container();
    const requestScope = root.createRequestScope();

    requestScope.register(
      { provide: 'REQ', useValue: 1, scope: 'request' },
      { provide: 'REQ2', useValue: 2, scope: 'request' },
      { provide: 'R3', useExisting: 'REQ2', scope: 'request' },
    );

    await expect(requestScope.resolve('REQ')).resolves.toBe(1);
    await expect(requestScope.resolve('R3')).resolves.toBe(2);
    expect(root.has('REQ')).toBe(false);
  });

  it('still rejects default and explicit singleton value or alias providers on a request scope', () => {
    const requestScope = new Container().register({ provide: 'target', useValue: 1 }).createRequestScope();

    expect(() => requestScope.register({ provide: 'value', useValue: 1 })).toThrow(ScopeMismatchError);
    expect(() => requestScope.register({ provide: 'value', useValue: 1, scope: 'singleton' })).toThrow(ScopeMismatchError);
    expect(() => requestScope.register({ provide: 'alias', useExisting: 'target' })).toThrow(ScopeMismatchError);
  });

  it('caches a request value per request scope and disposes it with that scope only', async () => {
    const token = Symbol('request-value');
    const value = disposableValue();
    const root = new Container().register({ provide: token, useValue: value, scope: 'request' });
    const first = root.createRequestScope();
    const second = root.createRequestScope();

    await expect(root.resolve(token)).rejects.toThrow(RequestScopeResolutionError);
    await expect(first.resolve(token)).resolves.toBe(value);
    await first.dispose();

    expect(value.onDestroy).toHaveBeenCalledTimes(1);
    await expect(second.resolve(token)).resolves.toBe(value);
    await root.dispose();
    expect(value.onDestroy).toHaveBeenCalledTimes(2);
  });

  it('rejects singleton consumers of request value providers with ScopeMismatchError', async () => {
    const token = Symbol('request-value');
    const consumer = Symbol('consumer');
    const requestConsumer = Symbol('request-consumer');
    const root = new Container().register(
      { provide: token, useValue: 'request-value', scope: 'request' },
      { provide: consumer, useFactory: (value: unknown) => value, inject: [token] },
      { provide: requestConsumer, useFactory: (value: unknown) => value, inject: [token], scope: 'request' },
    );
    const requestScope = root.createRequestScope();

    await expect(requestScope.resolve(consumer)).rejects.toThrow(ScopeMismatchError);
    await expect(requestScope.resolve(requestConsumer)).resolves.toBe('request-value');
  });

  it('lets request-scope override() introduce request value providers but not singleton ones', async () => {
    const requestScope = new Container().createRequestScope();

    expect(() => requestScope.override({ provide: 'singleton-value', useValue: 1 })).toThrow(ScopeMismatchError);
    requestScope.override({ provide: 'request-value', useValue: 2, scope: 'request' });

    await expect(requestScope.resolve('request-value')).resolves.toBe(2);
  });

  it('applies a transient override over a cached singleton value provider', async () => {
    const token = Symbol('overridden-value');
    const original = disposableValue();
    const replacement = disposableValue();
    const container = new Container().register({ provide: token, useValue: original });

    await container.resolve(token);
    container.override({ provide: token, useValue: replacement, scope: 'transient' });

    await expect(container.resolve(token)).resolves.toBe(replacement);
    expect(original.onDestroy).toHaveBeenCalledTimes(1);
    await container.dispose();
    expect(replacement.onDestroy).not.toHaveBeenCalled();
  });

  it('honors explicit scopes on multi value contributions', async () => {
    const token = Symbol('multi-values');
    const consumer = Symbol('consumer');
    const root = new Container().register(
      { provide: token, useValue: 'singleton', multi: true },
      { provide: token, useValue: 'request', multi: true, scope: 'request' },
      { provide: consumer, useFactory: (values: unknown) => values, inject: [token] },
    );
    const requestScope = root.createRequestScope();

    await expect(root.resolve(token)).rejects.toThrow(RequestScopeResolutionError);
    await expect(requestScope.resolve(token)).resolves.toEqual(['singleton', 'request']);
    await expect(requestScope.resolve(consumer)).rejects.toThrow(ScopeMismatchError);
  });

  it('isolates request-local value and alias multi contributions per request scope', async () => {
    const token = Symbol('plugins');
    const root = new Container().register(
      { provide: 'shared', useValue: 'shared' },
      { provide: token, useValue: 'root', multi: true },
    );
    const first = root.createRequestScope().register(
      { provide: token, useValue: 'first', multi: true, scope: 'request' },
      { provide: token, useExisting: 'shared', multi: true, scope: 'request' },
    );
    const second = root.createRequestScope();

    await expect(first.resolve(token)).resolves.toEqual(['root', 'first', 'shared']);
    await expect(second.resolve(token)).resolves.toEqual(['root']);
    await expect(root.resolve(token)).resolves.toEqual(['root']);
  });

  it('lets a request-scope override() introduce a request alias', async () => {
    const requestScope = new Container().register({ provide: 'target', useValue: 'target' }).createRequestScope();

    expect(() => requestScope.override({ provide: 'singleton-alias', useExisting: 'target' })).toThrow(ScopeMismatchError);
    requestScope.override({ provide: 'request-alias', useExisting: 'target', scope: 'request' });

    await expect(requestScope.resolve('request-alias')).resolves.toBe('target');
  });

  describe('alias scope semantics', () => {
    it('never owns an instance: aliases always yield the target instance with the target lifetime', async () => {
      class Target {}

      const transientAlias = Symbol('transient-alias');
      const requestAlias = Symbol('request-alias');
      const root = new Container().register(
        Target,
        { provide: transientAlias, useExisting: Target, scope: 'transient' },
        { provide: requestAlias, useExisting: Target, scope: 'request' },
      );
      const first = root.createRequestScope();
      const second = root.createRequestScope();
      const target = await root.resolve(Target);

      await expect(root.resolve(transientAlias)).resolves.toBe(target);
      await expect(root.resolve(transientAlias)).resolves.toBe(target);
      await expect(first.resolve(requestAlias)).resolves.toBe(target);
      await expect(second.resolve(requestAlias)).resolves.toBe(target);
    });

    it('keeps a transient target fresh through a default singleton alias', async () => {
      @Scope('transient')
      class TransientTarget {}

      const alias = Symbol('alias');
      const container = new Container().register(TransientTarget, { provide: alias, useExisting: TransientTarget });

      expect(await container.resolve(alias)).not.toBe(await container.resolve(alias));
    });

    it('rejects root resolution of a request-scoped alias even when its target is a singleton', async () => {
      const alias = Symbol('request-alias');
      const multiToken = Symbol('multi');
      const root = new Container().register(
        { provide: 'target', useValue: 'singleton-target' },
        { provide: alias, useExisting: 'target', scope: 'request' },
        { provide: multiToken, useExisting: 'target', multi: true, scope: 'request' },
      );

      await expect(root.resolve(alias)).rejects.toThrow(RequestScopeResolutionError);
      await expect(root.resolve(multiToken)).rejects.toThrow(RequestScopeResolutionError);
      await expect(root.createRequestScope().resolve(alias)).resolves.toBe('singleton-target');
      await expect(root.createRequestScope().resolve(multiToken)).resolves.toEqual(['singleton-target']);
    });

    it('rejects singleton consumers of a request-scoped alias over a singleton target, naming the alias', async () => {
      const alias = Symbol('RequestAlias');
      const outerAlias = Symbol('OuterAlias');
      const consumer = Symbol('Consumer');
      const viaChain = Symbol('ViaChain');
      const requestConsumer = Symbol('RequestConsumer');
      const root = new Container().register(
        { provide: 'target', useValue: 'singleton-target' },
        { provide: alias, useExisting: 'target', scope: 'request' },
        { provide: outerAlias, useExisting: alias },
        { provide: consumer, useFactory: (value: unknown) => value, inject: [alias] },
        { provide: viaChain, useFactory: (value: unknown) => value, inject: [outerAlias] },
        { provide: requestConsumer, useFactory: (value: unknown) => value, inject: [alias], scope: 'request' },
      );
      const requestScope = root.createRequestScope();

      await expect(requestScope.resolve(consumer)).rejects.toThrow(
        'Singleton provider Symbol(Consumer) depends on request-scoped provider Symbol(RequestAlias).',
      );
      await expect(requestScope.resolve(viaChain)).rejects.toThrow(
        'Singleton provider Symbol(ViaChain) depends on request-scoped provider Symbol(RequestAlias).',
      );
      await expect(requestScope.resolve(requestConsumer)).resolves.toBe('singleton-target');
    });

    it('still rejects singleton consumers of default aliases over request-scoped targets, naming the target', async () => {
      const alias = Symbol('Alias');
      const consumer = Symbol('Consumer');
      const requestScope = new Container().register(
        { provide: 'request-target', useValue: 'request', scope: 'request' },
        { provide: alias, useExisting: 'request-target', scope: 'transient' },
        { provide: consumer, useFactory: (value: unknown) => value, inject: [alias] },
      ).createRequestScope();

      await expect(requestScope.resolve(consumer)).rejects.toThrow(
        'Singleton provider Symbol(Consumer) depends on request-scoped provider request-target.',
      );
    });

    it('rejects singleton consumers of request-scoped multi alias contributions', async () => {
      const multiToken = Symbol('multi');
      const consumer = Symbol('consumer');
      const requestScope = new Container().register(
        { provide: 'target', useValue: 'singleton-target' },
        { provide: multiToken, useExisting: 'target', multi: true, scope: 'request' },
        { provide: consumer, useFactory: (values: unknown) => values, inject: [multiToken] },
      ).createRequestScope();

      await expect(requestScope.resolve(consumer)).rejects.toThrow(ScopeMismatchError);
    });

    it('keeps alias cycles reported as CircularDependencyError during singleton scope checks', async () => {
      const consumer = Symbol('consumer');
      const container = new Container().register(
        { provide: 'A', useExisting: 'B', scope: 'transient' },
        { provide: 'B', useExisting: 'A' },
        { provide: consumer, useFactory: (value: unknown) => value, inject: ['A'] },
      );

      await expect(container.resolve(consumer)).rejects.toThrow(CircularDependencyError);
    });
  });
});
