import { Controller, type FrameworkRequest, type FrameworkResponse, Get, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import type { CacheObservation, CacheObserver, CacheStore } from './types.js';

function createRecordingObserver(): { observations: CacheObservation[]; observer: CacheObserver } {
  const observations: CacheObservation[] = [];

  return {
    observations,
    observer: {
      onCacheOperation(observation) {
        observations.push(observation);
      },
    },
  };
}

class FailingStore implements CacheStore {
  async get<T>(_key: string): Promise<T | undefined> {
    throw new Error('store get failed');
  }

  async set<T>(_key: string, _value: T, _ttlSeconds?: number): Promise<void> {
    throw new Error('store set failed');
  }

  async del(_key: string): Promise<void> {
    throw new Error('store del failed');
  }

  async reset(): Promise<void> {
    throw new Error('store reset failed');
  }
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('CacheModule observer wiring', () => {
  it('observes HTTP interceptor cache misses and hits through the real dispatch pipeline', async () => {
    // Given: an application whose cache module is configured with a recording observer.
    const { observations, observer } = createRecordingObserver();
    const listHandler = vi.fn(() => ({ count: 1 }));

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        return listHandler();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ observer, store: 'memory' })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: the same route is dispatched twice.
      await app.dispatch(createRequest('/products'), createResponse());
      await app.dispatch(createRequest('/products'), createResponse());

      // Then: the interceptor read path reports one miss, one write, and one hit.
      expect(listHandler).toHaveBeenCalledTimes(1);
      expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
        ['get', 'miss'],
        ['set', 'success'],
        ['get', 'hit'],
      ]);
    } finally {
      await app.close();
    }
  });

  it('observes store errors that the HTTP interceptor fail-soft path hides from handlers', async () => {
    // Given: an application backed by a failing store and a recording observer.
    const { observations, observer } = createRecordingObserver();

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        return { count: 1 };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ observer, store: new FailingStore() })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // When: one request is dispatched against the failing store.
      const response = createResponse();
      await app.dispatch(createRequest('/products'), response);

      // Then: the handler result still succeeds while both failures are observed.
      expect(response.body).toEqual({ count: 1 });
      expect(observations.map((observation) => [observation.operation, observation.outcome])).toEqual([
        ['get', 'error'],
        ['set', 'error'],
      ]);
    } finally {
      await app.close();
    }
  });
});
