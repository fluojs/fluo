import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../types.js';

function createMockContext(): RequestContext {
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
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    },
    requestId: 'req_123',
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

describe('portable request context', () => {
  it('uses synchronous-only request context after importing the portable entrypoint without a host async store', async () => {
    // Given
    vi.resetModules();
    const getBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule');
    const nodeVersionDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');

    Object.defineProperty(process, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(process.versions, 'node', {
      configurable: true,
      value: undefined,
    });

    try {
      const portableHttp = await import('../index.portable.js');
      const context = portableHttp.createRequestContext(createMockContext());

      // When
      const observations = await portableHttp.runWithRequestContext(context, async () => {
        const beforeAwait = portableHttp.getCurrentRequestContext()?.requestId;
        await Promise.resolve();

        return {
          afterAwait: portableHttp.getCurrentRequestContext()?.requestId,
          beforeAwait,
        };
      });

      // Then
      expect(observations).toEqual({
        afterAwait: undefined,
        beforeAwait: 'req_123',
      });
    } finally {
      if (getBuiltinModuleDescriptor) {
        Object.defineProperty(process, 'getBuiltinModule', getBuiltinModuleDescriptor);
      } else {
        Reflect.deleteProperty(process, 'getBuiltinModule');
      }

      if (nodeVersionDescriptor) {
        Object.defineProperty(process.versions, 'node', nodeVersionDescriptor);
      }

      vi.resetModules();
    }
  });
});
