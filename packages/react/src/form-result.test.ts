import { Module } from '@fluojs/core';
import { Controller, Header, HttpCode, Post } from '@fluojs/http';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import * as ReactRoot from './index.js';
import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';

it.each([
  ...Array.from({ length: 33 }, (_, code) => `/products/${String.fromCharCode(code)}one`),
  '/products\\one',
  '//external.example/path',
  'https://external.example/path',
])('rejects a non-document or control-containing form destination %j', (destination) => {
  // Given/When: the application proposes an unsafe native redirect destination.
  // Then: form negotiation cannot change the native URL rejection contract.
  expect(() => ReactRoot.ReactModule.formResult({ destination, followUp: 'navigate' })).toThrow(TypeError);
});

it('approves an enhanced save while preserving the native 303 destination', async () => {
  // Given: one ordinary HTTP POST returning a runtime-neutral form result.
  const factory: unknown = Reflect.get(ReactRoot, 'ReactModule');
  expect(typeof factory).toBe('function');
  if (typeof factory !== 'function') throw new TypeError('Missing form result');
    const create: unknown = Reflect.get(factory, 'formResult');
  expect(typeof create).toBe('function');
  if (typeof create !== 'function') throw new TypeError('Missing form result creation');
  @Controller('/save')
  class SaveController {
    @Post('/')
    @Header('Vary', 'Cookie')
    save() {
      return ReactRoot.ReactModule.formResult({
        destination: '/products/one', followUp: 'navigate',
        data: { revision: 2 },
        session: { epoch: 'session-b', reason: 'login' },
      });
    }
    @Post('/refused')
    @HttpCode(403)
    refused() {
      return ReactRoot.ReactModule.formResult({ destination: '/products/one', followUp: 'navigate' });
    }
  }
  @Module({ controllers: [SaveController] })
  class AppModule {}
  const app = await FluoFactory.create(AppModule);
  const request = (accept: string): FrameworkRequest => ({
    body: {}, cookies: {}, headers: { accept }, method: 'POST',
    params: {}, path: '/save', query: {}, raw: {}, url: '/save',
  });
  const response = (): FrameworkResponse & { body?: unknown } => ({
    committed: false, headers: {},
    redirect(status, location) {
      this.setStatus(status); this.setHeader('Location', location); this.committed = true;
    },
    send(body) { this.body = body; this.committed = true; },
    setHeader(name, value) { this.headers[name] = value; },
    setStatus(status) { this.statusCode = status; this.statusSet = true; },
  });
  try {
    // When: the same handler is requested natively and with explicit form negotiation.
    const native = response();
    const enhanced = response();
    await app.dispatch(request('text/html'), native);
    await app.dispatch(request('application/vnd.fluo.form+json;v=1'), enhanced);
    // Then: only negotiated success is a saved acknowledgement; native behavior remains 303.
    expect(native.statusCode).toBe(303);
    expect(native.headers.Location).toBe('/products/one');
    expect(enhanced.statusCode).toBe(200);
    expect(enhanced.body).toEqual({
      version: 1, outcome: 'saved', destination: '/products/one', followUp: 'navigate',
      data: { revision: 2 },
      session: { epoch: 'session-b', reason: 'login' },
    });
    expect(enhanced.headers['Cache-Control']).toContain('no-store');
    expect(String(enhanced.headers.Vary).split(',').map((part) => part.trim())).toEqual(expect.arrayContaining(['Cookie', 'Accept']));
    const refused = response();
    await app.dispatch({ ...request('application/vnd.fluo.form+json;v=1'), path: '/save/refused', url: '/save/refused' }, refused);
    expect(refused.statusCode).toBe(403);
    expect(refused.body).toEqual({ version: 1, outcome: 'rejected' });
    expect(refused.headers.Location).toBeUndefined();
  } finally {
    await app.close();
  }
});
