import { Inject } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { forwardRef, optional } from './types.js';

describe('core @Inject wrapper compatibility', () => {
  it('accepts documented forwardRef and optional wrappers from @fluojs/di', () => {
    class Logger {}
    class Cache {}
    const loggerRef = forwardRef(() => Logger);
    const optionalCache = optional(Cache);

    @Inject(loggerRef, optionalCache)
    class WrappedTokenService {}

    expect(getClassDiMetadata(WrappedTokenService)).toEqual({
      inject: [loggerRef, optionalCache],
      scope: undefined,
    });
  });

  it('accepts documented wrapper tokens in the legacy array form', () => {
    const AUDIT_LOGGER = Symbol('AUDIT_LOGGER');
    const optionalAuditLogger = optional(AUDIT_LOGGER);

    @Inject([optionalAuditLogger])
    class LegacyWrappedTokenService {}

    expect(getClassDiMetadata(LegacyWrappedTokenService)).toEqual({
      inject: [optionalAuditLogger],
      scope: undefined,
    });
  });
});
