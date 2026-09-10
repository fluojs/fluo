import { Controller, Get } from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import { describe, expect, it } from 'vitest';

import * as publicApi from './index.js';
import { NodeHttpApplicationAdapter, type NodeHttpAdapterOptions } from './index.js';
import * as internalApi from './internal.js';

describe('NodeHttpApplicationAdapter.create', () => {
  it('preserves the class token, constructor, subclass, and instance lifecycle', async () => {
    // Given: both entrypoints expose the existing class, not a replacement class.
    class CustomAdapter extends NodeHttpApplicationAdapter {}
    const direct = new CustomAdapter(0, '127.0.0.1', 0, 0, false, undefined);
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    @Controller('/health')
    class HealthController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }
    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
      providers: [{ provide: NodeHttpApplicationAdapter, useValue: adapter }],
    });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      // When: the public adapter starts through the real application lifecycle.
      await app.listen();
      const response = await fetch(`${adapter.getListenTarget().url}/health`);

      // Then: DI and both entrypoints retain the same concrete instance identity.
      expect(internalApi.NodeHttpApplicationAdapter).toBe(NodeHttpApplicationAdapter);
      expect(direct).toBeInstanceOf(CustomAdapter);
      expect(direct).toBeInstanceOf(NodeHttpApplicationAdapter);
      expect(adapter).toBeInstanceOf(NodeHttpApplicationAdapter);
      expect(await app.container.resolve(NodeHttpApplicationAdapter)).toBe(adapter);
      expect(await app.container.resolve(HTTP_APPLICATION_ADAPTER)).toBe(adapter);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      const address = adapter.getServer().address();
      expect(address).toMatchObject({ address: '127.0.0.1', port: expect.any(Number) });
      if (!address || typeof address === 'string') {
        throw new Error('Expected an ephemeral TCP listener.');
      }
      expect(address.port).toBeGreaterThan(0);
    } finally {
      await app.close();
      await direct.close();
    }
    expect(adapter.getServer().listening).toBe(false);
    await adapter.close();
  });

  it.each([publicApi, internalApi])('does not expose duplicate adapter creation exports', (api) => {
    for (const name of [
      'createNodejsAdapter',
      'createNodeHttpAdapter',
      'NodejsAdapterOptions',
      'NodejsHttpApplicationAdapter',
    ]) {
      expect(api).not.toHaveProperty(name);
    }
  });

  const multipartCases: readonly {
    readonly name: string;
    readonly options: NodeHttpAdapterOptions;
    readonly content: string;
    readonly status: number;
  }[] = [
    { name: 'omitted total inherits the explicit body cap', options: { maxBodySize: 128 }, content: 'hello', status: 413 },
    { name: 'explicit total may exceed the non-multipart body cap', options: { maxBodySize: 8, multipart: { maxTotalSize: 1024 } }, content: 'hello', status: 200 },
    { name: 'explicit total may be lower than the body cap', options: { maxBodySize: 1024, multipart: { maxTotalSize: 128 } }, content: 'hello', status: 413 },
    { name: 'zero total is not replaced with a default', options: { multipart: { maxTotalSize: 0 } }, content: 'hello', status: 413 },
    { name: 'file limits survive options consolidation', options: { multipart: { maxFileSize: 3 } }, content: 'hello', status: 413 },
    { name: 'omitted body and total retain the 1 MiB cap', options: {}, content: 'x'.repeat(1_048_577), status: 413 },
    { name: 'omitted total inherits an increased body cap', options: { maxBodySize: 2_097_152 }, content: 'x'.repeat(1_048_577), status: 200 },
  ];

  it.each(multipartCases)('$name through a real Node listener', async ({ options, content, status }) => {
    // Given: transport and multipart settings enter only through static create.
    const adapter = NodeHttpApplicationAdapter.create({ ...options, host: '127.0.0.1', port: 0 });
    const form = new FormData();
    form.set('name', 'Ada');
    form.set('payload', new Blob([content]), 'payload.txt');

    try {
      await adapter.listen({
        async dispatch(request, response) {
          await response.send(request.body);
        },
      });
      // When: the complete multipart payload crosses the real listener.
      const response = await fetch(adapter.getListenTarget().url, { body: form, method: 'POST' });
      const body: unknown = await response.json();

      // Then: explicit limits and omitted defaults govern observable admission.
      expect(response.status).toBe(status);
      if (status === 200) {
        expect(body).toEqual({ name: 'Ada' });
      } else {
        expect(body).toMatchObject({ error: { status: 413 } });
      }
    } finally {
      await adapter.close();
    }
  });
});
