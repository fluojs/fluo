import { Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  InvalidNextAdapterOptionError,
  NextHttpApplicationAdapter,
} from './index.js';

@Controller('/api')
class HealthController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

describe('canonical Next adapter creation', () => {
  it('creates independent class instances usable by FluoFactory', async () => {
    // Given the public class token and explicit parser/routing options.
    const adapter = NextHttpApplicationAdapter.create({
      headRouting: 'explicit-or-get',
      maxBodySize: 32,
      rawBody: true,
    });
    const other = NextHttpApplicationAdapter.create();
    const app = await FluoFactory.create(AppModule, { adapter });
    try {
      // When the ordinary application lifecycle binds the adapter.
      await app.listen();
      const response = await adapter.fetch(new Request('https://next.test/api/health'));
      // Then creation preserves the class and isolates each adapter's state.
      expect(adapter).toBeInstanceOf(NextHttpApplicationAdapter);
      expect(other).not.toBe(adapter);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect((await other.fetch(new Request('https://next.test/api/health'))).status).toBe(503);
    } finally {
      await app.close();
      await other.close();
    }
    expect((await adapter.fetch(new Request('https://next.test/api/health'))).status).toBe(503);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxBodySize %s through static and constructor creation',
    (maxBodySize) => {
      // Given an invalid public option.
      // When either supported construction mechanism receives it.
      // Then both preserve the existing error class.
      expect(() => NextHttpApplicationAdapter.create({ maxBodySize }))
        .toThrow(InvalidNextAdapterOptionError);
      expect(() => new NextHttpApplicationAdapter({ maxBodySize }))
        .toThrow(InvalidNextAdapterOptionError);
    },
  );

  it('retains constructor inheritance without adapter method aliases', async () => {
    // Given a consumer subclass using the existing public constructor.
    class CustomAdapter extends NextHttpApplicationAdapter {}
    const adapter = new CustomAdapter({ maxBodySize: 0 });
    try {
      // When inspecting the constructed adapter, not a router facade.
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      // Then class identity and the one instance dispatch operation remain.
      expect(adapter).toBeInstanceOf(CustomAdapter);
      expect(adapter).toBeInstanceOf(NextHttpApplicationAdapter);
      expect(adapter.fetch).toBeTypeOf('function');
      for (const method of methods) expect(method in adapter).toBe(false);
    } finally {
      await adapter.close();
    }
  });
});
