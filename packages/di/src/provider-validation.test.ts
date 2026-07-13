import { describe, expect, it } from 'vitest';

import { Inject } from '@fluojs/core';

import { Container } from './container.js';
import { InvalidProviderError } from './errors.js';

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
});
