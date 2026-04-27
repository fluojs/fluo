import { describe, expect, it } from 'vitest';

import { Global, Inject, Module, Scope } from './decorators.js';
import { getClassDiMetadata, getModuleMetadata, getOwnClassDiMetadata } from './metadata.js';

describe('core decorators', () => {
  it('writes module metadata through decorators', () => {
    class SharedModule {}

    @Global()
    @Module({
      exports: ['LOGGER'],
      imports: [SharedModule],
      providers: ['LoggerProvider'],
    })
    class AppModule {}

    expect(getModuleMetadata(AppModule)).toEqual({
      controllers: undefined,
      exports: ['LOGGER'],
      global: true,
      imports: [SharedModule],
      middleware: undefined,
      providers: ['LoggerProvider'],
    });
  });

  it('writes inject and scope metadata through decorators', () => {
    const LOGGER = Symbol('LOGGER');

    @Inject(LOGGER)
    @Scope('request')
    class AppService {}

    expect(getClassDiMetadata(AppService)).toEqual({
      inject: [LOGGER],
      scope: 'request',
    });
  });

  it.each(['singleton', 'request', 'transient'] as const)('writes %s scope metadata through @Scope', (scope) => {
    @Scope(scope)
    class ScopedService {}

    expect(getClassDiMetadata(ScopedService)).toEqual({
      inject: undefined,
      scope,
    });
  });

  it('inherits DI metadata through decorators while keeping own reads separate', () => {
    const LOGGER = Symbol('LOGGER');

    @Inject(LOGGER)
    @Scope('request')
    class BaseService {}

    class ChildService extends BaseService {}

    expect(getOwnClassDiMetadata(ChildService)).toBeUndefined();
    expect(getClassDiMetadata(ChildService)).toEqual({
      inject: [LOGGER],
      scope: 'request',
    });
  });

  it('treats @Inject() as an explicit empty inject override', () => {
    const LOGGER = Symbol('LOGGER');

    @Inject(LOGGER)
    @Scope('request')
    class BaseService {}

    @Inject()
    class ChildService extends BaseService {}

    expect(getOwnClassDiMetadata(ChildService)).toEqual({
      inject: [],
      scope: undefined,
    });
    expect(getClassDiMetadata(ChildService)).toEqual({
      inject: [],
      scope: 'request',
    });
  });

  it('keeps the legacy array syntax working during the migration window', () => {
    const LOGGER = Symbol('LOGGER');
    const CACHE = Symbol('CACHE');

    @Inject([LOGGER, CACHE])
    class LegacyArrayService {}

    expect(getClassDiMetadata(LegacyArrayService)).toEqual({
      inject: [LOGGER, CACHE],
      scope: undefined,
    });
  });

  it('normalizes legacy array inject tokens before caller-owned arrays can mutate metadata', () => {
    const LOGGER = Symbol('LOGGER');
    const CACHE = Symbol('CACHE');
    const tokens = [LOGGER, CACHE];
    const decorator = Inject(tokens);

    tokens.push(Symbol('MUTATED'));
    @decorator
    class LegacyArrayService {}
    tokens.push(Symbol('LATE_MUTATION'));

    expect(getClassDiMetadata(LegacyArrayService)).toEqual({
      inject: [LOGGER, CACHE],
      scope: undefined,
    });
  });

  it('stores an explicit empty inject list for zero-dependency classes', () => {
    @Inject()
    class ZeroDependencyService {}

    expect(getOwnClassDiMetadata(ZeroDependencyService)).toEqual({
      inject: [],
      scope: undefined,
    });
  });
});
