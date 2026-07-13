import { InvalidProviderError } from '@fluojs/di';
import { beforeEach, describe, expect, it } from 'vitest';

import { bootstrapModule } from './bootstrap.js';
import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import {
  clearModuleGraphCompileCacheForTesting,
  compileModuleGraph,
  getModuleGraphCompileCacheSizeForTesting,
} from './module-graph.js';

const malformedModuleProviders = [
  [
    'object inject value',
    { provide: Symbol('object-inject'), useFactory: () => undefined, inject: { token: 'dependency' } },
  ],
  [
    'string inject value',
    { provide: Symbol('string-inject'), useClass: class Service {}, inject: 'dependency' },
  ],
  [
    'forwardRef wrapper',
    {
      provide: Symbol('malformed-forward-ref'),
      useFactory: () => undefined,
      inject: [{ __forwardRef__: true, forwardRef: 'dependency' }],
    },
  ],
  [
    'plain object inject token',
    { provide: Symbol('plain-object-token'), useFactory: () => undefined, inject: [{}] },
  ],
  [
    'scope value',
    { provide: Symbol('invalid-scope'), useFactory: () => undefined, scope: 'session' },
  ],
] as const;

describe('module graph provider input validation', () => {
  beforeEach(() => {
    clearModuleGraphCompileCacheForTesting();
  });

  it.each(malformedModuleProviders)('normalizes a malformed %s before module provider traversal', (_kind, provider) => {
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, { providers: [provider] });

    expect(() => compileModuleGraph(AppModule)).toThrow(InvalidProviderError);
  });

  it('normalizes malformed runtime providers before cache-key traversal', () => {
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});
    const options = {
      moduleGraphCache: true,
      providers: [
        { provide: Symbol('runtime-provider'), useFactory: () => undefined, inject: 'dependency' },
      ],
    };

    expect(() => Reflect.apply(compileModuleGraph, undefined, [AppModule, options])).toThrow(InvalidProviderError);
    expect(getModuleGraphCompileCacheSizeForTesting()).toBe(0);
  });

  it('propagates malformed module provider failures through bootstrapModule', () => {
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {
      providers: [
        {
          provide: Symbol('malformed-optional'),
          useFactory: () => undefined,
          inject: [{ __optional__: true, token: {} }],
        },
      ],
    });

    expect(() => bootstrapModule(AppModule)).toThrow(InvalidProviderError);
  });
});
