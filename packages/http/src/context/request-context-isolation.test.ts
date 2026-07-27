import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../types.js';

function createContext(): RequestContext {
  const root = new Container();

  return {
    container: root.createRequestScope(),
    metadata: {},
    request: {
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/context-isolation',
      query: {},
      raw: {},
      url: '/context-isolation',
    },
    requestId: 'request-context-isolation',
    response: {
      committed: false,
      headers: {},
      redirect() {},
      send() {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      setStatus(code) {
        this.statusCode = code;
      },
      statusCode: 200,
    },
  };
}

describe('lazy request context isolation', () => {
  it('does not replace Promise.prototype.then while Node async storage resolves', async () => {
    // Given
    vi.resetModules();
    const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    const originalThen = Promise.prototype.then;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    Object.defineProperty(process, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
    });

    try {
      const requestContext = await import('./request-context.js');

      // When
      const result = requestContext.runWithRequestContext(createContext(), () => pending);

      // Then
      expect(Promise.prototype.then).toBe(originalThen);
      release?.();
      await result;
    } finally {
      release?.();
      if (getBuiltinModuleDescriptor) {
        Object.defineProperty(process, 'getBuiltinModule', getBuiltinModuleDescriptor);
      }
      vi.resetModules();
    }
  });

  it('does not expose a pending request context to unrelated promise continuations', async () => {
    // Given
    vi.resetModules();
    const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    Object.defineProperty(process, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
    });

    try {
      const requestContext = await import('./request-context.js');
      const scopedResult = requestContext.runWithRequestContext(createContext(), () => pending);

      // When
      const unrelatedRequestId = await Promise.resolve().then(
        () => requestContext.getCurrentRequestContext()?.requestId,
      );

      // Then
      expect(unrelatedRequestId).toBeUndefined();
      release?.();
      await scopedResult;
    } finally {
      release?.();
      if (getBuiltinModuleDescriptor) {
        Object.defineProperty(process, 'getBuiltinModule', getBuiltinModuleDescriptor);
      }
      vi.resetModules();
    }
  });
});
