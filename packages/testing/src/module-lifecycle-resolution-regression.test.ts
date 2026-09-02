import { Module } from '@fluojs/core';
import { CircularDependencyError, ScopeMismatchError } from '@fluojs/di';
import { describe, expect, it } from 'vitest';

import { createTestingModule } from './index.js';

describe('testing module lifecycle contribution resolution', () => {
  it('rejects a self-referential singleton multi contribution with CircularDependencyError', async () => {
    // Given
    const PLUGINS = Symbol('self-referential-lifecycle-plugins');

    @Module({
      providers: [
        {
          inject: [PLUGINS],
          multi: true,
          provide: PLUGINS,
          useFactory: (plugins: unknown) => ({
            onModuleInit() {
              return plugins;
            },
          }),
        },
      ],
    })
    class SelfReferentialLifecycleModule {}

    // When
    const compilation = createTestingModule({ rootModule: SelfReferentialLifecycleModule }).compile();

    // Then
    await expect(compilation).rejects.toBeInstanceOf(CircularDependencyError);
  }, 1_000);

  it('rejects a singleton multi contribution depending on request scope with ScopeMismatchError', async () => {
    // Given
    const PLUGINS = Symbol('scope-mismatched-lifecycle-plugins');
    const REQUEST_CONTEXT = Symbol('request-lifecycle-context');

    @Module({
      providers: [
        {
          provide: REQUEST_CONTEXT,
          scope: 'request',
          useFactory: () => ({ id: 'request-context' }),
        },
        {
          inject: [REQUEST_CONTEXT],
          multi: true,
          provide: PLUGINS,
          useFactory: (context: unknown) => ({
            onModuleInit() {
              return context;
            },
          }),
        },
      ],
    })
    class ScopeMismatchedLifecycleModule {}

    // When
    const compilation = createTestingModule({ rootModule: ScopeMismatchedLifecycleModule }).compile();

    // Then
    await expect(compilation).rejects.toBeInstanceOf(ScopeMismatchError);
  });
});
