import { describe, expect, it } from 'vitest';

import { Global, Inject, Module, Scope } from './decorators.js';
import { getClassDiMetadata, getModuleMetadata, getOwnClassDiMetadata } from './metadata.js';
import type { ForwardRefToken, OptionalInjectToken, Token } from './types.js';

type MutableForwardRefToken<T = unknown> = {
  __forwardRef__: true;
  forwardRef: () => Token<T>;
};

type MutableOptionalInjectToken<T = unknown> = {
  __optional__: true;
  token: Token<T>;
};

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

  it('passes forwardRef and optional token wrappers through inject metadata', () => {
    class Logger {}
    class Cache {}
    const forwardLogger: ForwardRefToken<Logger> = {
      __forwardRef__: true,
      forwardRef: () => Logger,
    };
    const optionalCache: OptionalInjectToken<Cache> = {
      __optional__: true,
      token: Cache,
    };

    @Inject(forwardLogger, optionalCache)
    class WrappedTokenService {}

    expect(getClassDiMetadata(WrappedTokenService)).toEqual({
      inject: [forwardLogger, optionalCache],
      scope: undefined,
    });
  });

  it('snapshots wrapper tokens before post-decoration wrapper mutations can affect metadata', () => {
    class Logger {}
    class MutatedLogger {}
    class Cache {}
    class MutatedCache {}

    const forwardLoggerRef = () => Logger;
    const forwardLogger: MutableForwardRefToken<Logger | MutatedLogger> = {
      __forwardRef__: true,
      forwardRef: forwardLoggerRef,
    };
    const optionalCache: MutableOptionalInjectToken<Cache | MutatedCache> = {
      __optional__: true,
      token: Cache,
    };

    @Inject(forwardLogger, optionalCache)
    class WrappedTokenService {}

    forwardLogger.forwardRef = () => MutatedLogger;
    optionalCache.token = MutatedCache;

    const metadata = getClassDiMetadata(WrappedTokenService);
    const storedForwardToken = metadata?.inject?.[0];
    const storedOptionalToken = metadata?.inject?.[1];

    expect(storedForwardToken).toEqual({
      __forwardRef__: true,
      forwardRef: forwardLoggerRef,
    });
    expect(storedForwardToken).not.toBe(forwardLogger);
    expect(Object.isFrozen(storedForwardToken)).toBe(true);
    if (typeof storedForwardToken !== 'object' || storedForwardToken === null || !('__forwardRef__' in storedForwardToken)) {
      throw new Error('Expected stored forwardRef metadata wrapper');
    }
    expect(storedForwardToken.forwardRef()).toBe(Logger);

    expect(storedOptionalToken).toEqual({
      __optional__: true,
      token: Cache,
    });
    expect(storedOptionalToken).not.toBe(optionalCache);
    expect(Object.isFrozen(storedOptionalToken)).toBe(true);
  });

  it('keeps wrapper tokens type-compatible with the legacy array syntax', () => {
    const LOGGER = Symbol('LOGGER');
    const optionalLogger: OptionalInjectToken = {
      __optional__: true,
      token: LOGGER,
    };

    @Inject([optionalLogger])
    class LegacyWrappedTokenService {}

    expect(getClassDiMetadata(LegacyWrappedTokenService)).toEqual({
      inject: [optionalLogger],
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
