import { Controller, type FrameworkRequest, type FrameworkResponse, Post, Redirect, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheEvict } from './decorators.js';
import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { CacheService } from './service.js';

type SimpleJsonDispatchResponse = FrameworkResponse & {
  body?: unknown;
  sendSimpleJson(body: Record<string, unknown> | unknown[]): void;
};

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'POST',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createSimpleJsonResponse(): SimpleJsonDispatchResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send: vi.fn(function send(this: SimpleJsonDispatchResponse, body: unknown) {
      this.body = body;
      this.committed = true;
    }),
    sendSimpleJson: vi.fn(function sendSimpleJson(this: SimpleJsonDispatchResponse, body) {
      this.body = body;
      this.committed = true;
    }),
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

describe('CacheInterceptor response dispatch regressions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts after normal JSON dispatch commits through sendSimpleJson', async () => {
    // Given
    @Controller('/products')
    @UseInterceptors(CacheInterceptor)
    class ProductController {
      @Post('/refresh')
      @CacheEvict('/products')
      refresh() {
        return { refreshed: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ store: 'memory' })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const cache = await app.container.resolve(CacheService);
      await cache.set('/products', { version: 'previous' }, 120);
      const response = createSimpleJsonResponse();

      // When
      await app.dispatch(createRequest('/products/refresh'), response);

      // Then
      expect(response.sendSimpleJson).toHaveBeenCalledTimes(1);
      await expect(cache.get('/products')).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('preserves cached reads when normal JSON dispatch fails through sendSimpleJson', async () => {
    // Given
    @Controller('/products')
    @UseInterceptors(CacheInterceptor)
    class ProductController {
      @Post('/refresh')
      @CacheEvict('/products')
      refresh() {
        return { refreshed: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ store: 'memory' })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const cache = await app.container.resolve(CacheService);
      await cache.set('/products', { version: 'previous' }, 120);
      const response = createSimpleJsonResponse();
      response.sendSimpleJson = vi.fn(async () => {
        throw new Error('simple JSON commit failed');
      });

      // When
      await app.dispatch(createRequest('/products/refresh'), response);

      // Then
      expect(response.sendSimpleJson).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(500);
      await expect(cache.get('/products')).resolves.toEqual({ version: 'previous' });
    } finally {
      await app.close();
    }
  });

  it('evicts through the bounded fallback after a no-send response commit is confirmed', async () => {
    // Given
    vi.useFakeTimers();
    @Controller('/products')
    @UseInterceptors(CacheInterceptor)
    class ProductController {
      @Post('/refresh')
      @Redirect('/products', 303)
      @CacheEvict('/products')
      refresh() {
        return { refreshed: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot({ store: 'memory' })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const cache = await app.container.resolve(CacheService);
      await cache.set('/products', { version: 'previous' }, 120);
      const response = createSimpleJsonResponse();
      await app.dispatch(createRequest('/products/refresh'), response);

      // When
      await vi.advanceTimersByTimeAsync(5_000);

      // Then
      await expect(cache.get('/products')).resolves.toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
