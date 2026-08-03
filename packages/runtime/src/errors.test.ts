import { FluoError } from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import type { PlatformLifecycleOperation } from './index.js';
import * as runtime from './index.js';

describe('runtime error exports', () => {
  it('exports PlatformLifecycleConflictError with typed structured context from the root', () => {
    // Given
    const operations: readonly PlatformLifecycleOperation[] = ['start', 'stop'];

    // When
    const conflictErrorExport: unknown = Reflect.get(runtime, 'PlatformLifecycleConflictError');

    // Then
    if (typeof conflictErrorExport !== 'function') {
      expect(conflictErrorExport).toBeTypeOf('function');
      return;
    }

    const error: unknown = Reflect.construct(conflictErrorExport, operations);
    expect(error).toBeInstanceOf(FluoError);
    expect(error).toMatchObject({
      activeOperation: 'start',
      code: 'PLATFORM_LIFECYCLE_CONFLICT',
      meta: {
        activeOperation: 'start',
        requestedOperation: 'stop',
      },
      name: 'PlatformLifecycleConflictError',
      requestedOperation: 'stop',
    });
  });
});
