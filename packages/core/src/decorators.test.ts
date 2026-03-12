import { describe, expect, it } from 'vitest';

import { Global, Inject, Module, Scope } from './decorators';
import { getClassDiMetadata, getModuleMetadata } from './metadata';

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
});
