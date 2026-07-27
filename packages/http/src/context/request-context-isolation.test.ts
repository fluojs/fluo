import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../types.js';

function createContext(requestId = 'request-context-isolation'): RequestContext {
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
    requestId,
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
  it('preserves promise-returning non-async callback context without replacing Promise.prototype.then', async () => {
    // Given
    vi.resetModules();
    const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    const originalThen = Promise.prototype.then;

    Object.defineProperty(process, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
    });

    try {
      const http = await import('../index.js');

      // When
      const requestId = http.runWithRequestContext(createContext('promise-callback'), () =>
        Promise.resolve().then(() => http.getCurrentRequestContext()?.requestId),
      );

      // Then
      expect(Promise.prototype.then).toBe(originalThen);
      await expect(requestId).resolves.toBe('promise-callback');
    } finally {
      if (getBuiltinModuleDescriptor) {
        Object.defineProperty(process, 'getBuiltinModule', getBuiltinModuleDescriptor);
      }
      vi.resetModules();
    }
  });

  it('isolates concurrent promise-returning non-async callback contexts', async () => {
    // Given
    vi.resetModules();
    const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    const releaseA = createDeferred<void>();
    const releaseB = createDeferred<void>();

    Object.defineProperty(process, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
    });

    try {
      const http = await import('../index.js');

      // When
      const requestA = http.runWithRequestContext(createContext('request-a'), () =>
        releaseA.promise.then(() => http.getCurrentRequestContext()?.requestId),
      );
      const requestB = http.runWithRequestContext(createContext('request-b'), () => {
        releaseA.resolve();

        return releaseB.promise.then(() => http.getCurrentRequestContext()?.requestId);
      });

      await Promise.resolve();
      releaseB.resolve();

      // Then
      await expect(requestA).resolves.toBe('request-a');
      await expect(requestB).resolves.toBe('request-b');
    } finally {
      if (getBuiltinModuleDescriptor) {
        Object.defineProperty(process, 'getBuiltinModule', getBuiltinModuleDescriptor);
      }
      vi.resetModules();
    }
  });

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

function createDeferred<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolvePromise = promiseResolve;
  });

  if (!resolvePromise) {
    throw new TypeError('Promise executor did not initialize its resolver synchronously.');
  }

  return { promise, resolve: resolvePromise };
}
