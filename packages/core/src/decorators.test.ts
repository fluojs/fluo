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

    @Inject([LOGGER])
    @Scope('request')
    class AppService {}

    expect(getClassDiMetadata(AppService)).toEqual({
      inject: [LOGGER],
      scope: 'request',
    });
  });

  it('inherits DI metadata through decorators while keeping own reads separate', () => {
    const LOGGER = Symbol('LOGGER');

    @Inject([LOGGER])
    @Scope('request')
    class BaseService {}

    class ChildService extends BaseService {}

    expect(getOwnClassDiMetadata(ChildService)).toBeUndefined();
    expect(getClassDiMetadata(ChildService)).toEqual({
      inject: [LOGGER],
      scope: 'request',
    });
  });
});
