import { Inject } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { ForwardRef, Optional } from './types.js';

describe('core @Inject wrapper compatibility', () => {
  it('accepts documented forwardRef and optional wrappers from @fluojs/di', () => {
    class Logger {}
    class Cache {}
    const loggerRef = ForwardRef.create(() => Logger);
    const optionalCache = Optional.create(Cache);

    @Inject(loggerRef, optionalCache)
    class WrappedTokenService {}

    expect(getClassDiMetadata(WrappedTokenService)).toEqual({
      inject: [loggerRef, optionalCache],
      scope: undefined,
    });
  });

  it('accepts documented wrapper tokens in spread lists', () => {
    const AUDIT_LOGGER = Symbol('AUDIT_LOGGER');
    const optionalAuditLogger = Optional.create(AUDIT_LOGGER);

    @Inject(...[optionalAuditLogger])
    class WrappedTokenService {}

    expect(getClassDiMetadata(WrappedTokenService)).toEqual({
      inject: [optionalAuditLogger],
      scope: undefined,
    });
  });
});
