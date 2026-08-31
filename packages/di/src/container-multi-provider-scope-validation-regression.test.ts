import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { ScopeMismatchError } from './errors.js';
import { Scope } from './types.js';

describe('singleton dependency scope validation across multi providers', () => {
  it('fails with ScopeMismatchError before any multi-provider factory runs', async () => {
    // Given
    const pluginToken = Symbol('plugins');
    const factoryCalls: string[] = [];
    const container = new Container().register(
      {
        multi: true,
        provide: pluginToken,
        useFactory: () => {
          factoryCalls.push('singleton-plugin');
          return 'singleton-plugin';
        },
      },
      {
        multi: true,
        provide: pluginToken,
        scope: Scope.REQUEST,
        useFactory: () => {
          factoryCalls.push('request-plugin');
          return 'request-plugin';
        },
      },
      {
        inject: [pluginToken],
        provide: 'PluginRegistry',
        useFactory: (plugins: unknown) => plugins,
      },
    );

    // When
    const resolution = container.resolve('PluginRegistry');

    // Then
    await expect(resolution).rejects.toThrow(ScopeMismatchError);
    expect(factoryCalls).toEqual([]);
  });

  it('reports the request-scoped multi contribution token in the scope mismatch message', async () => {
    // Given
    const pluginToken = Symbol('scoped-plugins');
    const container = new Container().register(
      {
        multi: true,
        provide: pluginToken,
        scope: Scope.REQUEST,
        useFactory: () => 'request-plugin',
      },
      {
        inject: [pluginToken],
        provide: 'ScopedPluginRegistry',
        useFactory: (plugins: unknown) => plugins,
      },
    );

    // When
    const error = await container.resolve('ScopedPluginRegistry').catch((thrown: unknown) => thrown);

    // Then
    expect(error).toBeInstanceOf(ScopeMismatchError);
    expect((error as ScopeMismatchError).message).toContain('Symbol(scoped-plugins)');
  });

  it('fails with ScopeMismatchError when an alias targets a request-scoped multi contribution', async () => {
    // Given
    const pluginToken = Symbol('aliased-plugins');
    const aliasToken = Symbol('plugins-alias');
    let factoryCalls = 0;
    const container = new Container().register(
      {
        multi: true,
        provide: pluginToken,
        scope: Scope.REQUEST,
        useFactory: () => {
          factoryCalls += 1;
          return 'request-plugin';
        },
      },
      { provide: aliasToken, useExisting: pluginToken },
      {
        inject: [aliasToken],
        provide: 'AliasedPluginRegistry',
        useFactory: (plugins: unknown) => plugins,
      },
    );

    // When
    const resolution = container.resolve('AliasedPluginRegistry');

    // Then
    await expect(resolution).rejects.toThrow(ScopeMismatchError);
    expect(factoryCalls).toBe(0);
  });

  it('still resolves a singleton depending on singleton-only multi contributions', async () => {
    // Given
    const pluginToken = Symbol('singleton-only-plugins');
    const container = new Container().register(
      { multi: true, provide: pluginToken, useValue: 'first' },
      { multi: true, provide: pluginToken, useValue: 'second' },
      {
        inject: [pluginToken],
        provide: 'SingletonOnlyRegistry',
        useFactory: (plugins: unknown) => plugins,
      },
    );

    // When
    const plugins = await container.resolve('SingletonOnlyRegistry');

    // Then
    expect(plugins).toEqual(['first', 'second']);
  });

  it('resolves request-scoped multi contributions from a request scope container', async () => {
    // Given
    const pluginToken = Symbol('request-scope-plugins');
    const root = new Container().register(
      { multi: true, provide: pluginToken, useValue: 'singleton-plugin' },
      { multi: true, provide: pluginToken, scope: Scope.REQUEST, useFactory: () => 'request-plugin' },
    );
    const requestScope = root.createRequestScope();

    // When
    const plugins = await requestScope.resolve(pluginToken);

    // Then
    expect(plugins).toEqual(['singleton-plugin', 'request-plugin']);
  });
});
