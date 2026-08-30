import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { ContainerResolutionError } from './errors.js';
import { Scope } from './types.js';

describe('Container construction boundary', () => {
  it('supports zero-argument root construction', async () => {
    // Given
    const token = Symbol('root-value');
    const container = new Container().register({ provide: token, useValue: 'root' });

    // When
    const resolved = await container.resolve<string>(token);

    // Then
    expect(resolved).toBe('root');
  });

  it('rejects caller-supplied child-scope constructor arguments', () => {
    // Given
    const root = new Container();

    // When
    const construct = (): object => Reflect.construct(Container, [root, true, new Map()]);

    // Then
    expect(construct).toThrow(ContainerResolutionError);
    expect(construct).toThrow(/createRequestScope\(\)/);
  });

  it('rejects a caller-supplied parent even without cache wiring', () => {
    // Given
    const root = new Container();

    // When
    const construct = (): object => Reflect.construct(Container, [root]);

    // Then
    expect(construct).toThrow(ContainerResolutionError);
  });

  it('keeps createRequestScope() as the supported child-scope path', async () => {
    // Given
    const singletonToken = Symbol('shared-singleton');
    const requestToken = Symbol('request-scoped');
    const root = new Container().register(
      { provide: singletonToken, useFactory: () => ({ id: 'singleton' }) },
      { provide: requestToken, scope: Scope.REQUEST, useFactory: () => ({ id: 'request' }) },
    );

    // When
    const firstScope = root.createRequestScope();
    const secondScope = root.createRequestScope();
    const rootSingleton = await root.resolve(singletonToken);
    const firstSingleton = await firstScope.resolve(singletonToken);
    const secondSingleton = await secondScope.resolve(singletonToken);
    const firstRequestInstance = await firstScope.resolve(requestToken);
    const secondRequestInstance = await secondScope.resolve(requestToken);

    // Then
    expect(firstSingleton).toBe(rootSingleton);
    expect(secondSingleton).toBe(rootSingleton);
    expect(firstRequestInstance).not.toBe(secondRequestInstance);
    await expect(root.resolve(requestToken)).rejects.toThrow();
  });

  it('keeps request-scope disposal terminal after the parent is disposed', async () => {
    // Given
    const root = new Container();
    const scope = root.createRequestScope();

    // When
    await root.dispose();

    // Then
    expect(() => scope.createRequestScope()).toThrow(ContainerResolutionError);
  });
});
