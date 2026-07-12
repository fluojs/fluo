import { Controller, Get } from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { createWebRuntimeHttpAdapterPortabilityHarness } from '@fluojs/testing/web-runtime-adapter-portability';
import { describe, expect, it, vi } from 'vitest';

import {
  type BootstrapDenoApplicationOptions,
  bootstrapDenoApplication,
  createDenoFetchHandler,
  type DenoServeFunction,
} from './index.js';

function registerHostOwnedDenoPortabilitySuite(): void {
  const harness = createWebRuntimeHttpAdapterPortabilityHarness<BootstrapDenoApplicationOptions>({
    async bootstrap(rootModule: ModuleType, options: BootstrapDenoApplicationOptions) {
      const serve = vi.fn<DenoServeFunction>();
      const app = await bootstrapDenoApplication(rootModule, {
        ...options,
        serve,
      });
      const handler = createDenoFetchHandler({
        dispatcher: app.dispatcher,
        maxBodySize: options.maxBodySize,
        multipart: options.multipart,
        rawBody: options.rawBody,
      });

      expect(serve).not.toHaveBeenCalled();

      return {
        async close() {
          await app.close();
        },
        async dispatch(request: Request) {
          return await handler(request);
        },
      };
    },
    name: 'host-owned Deno fetch handler',
  });

  describe('host-owned Deno fetch handler portability', () => {
    it('preserves malformed cookie values', async () => {
      await harness.assertPreservesMalformedCookieValues();
    });

    it('preserves query arrays and malformed query decoding', async () => {
      await harness.assertPreservesQueryArraysAndDecoding();
    });

    it('preserves raw bodies for JSON and text requests', async () => {
      await harness.assertPreservesRawBodyForJsonAndText();
    });

    it('preserves byte-exact raw bodies', async () => {
      await harness.assertPreservesExactRawBodyBytesForByteSensitivePayloads();
    });

    it('excludes rawBody for multipart requests', async () => {
      await harness.assertExcludesRawBodyForMultipart();
    });

    it('preserves SSE framing', async () => {
      await harness.assertSupportsSseStreaming();
    });
  });
}

describe('createDenoFetchHandler', () => {
  registerHostOwnedDenoPortabilitySuite();

  it('dispatches through an already bootstrapped application without starting Deno.serve', async () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      read() {
        return { ok: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [HealthController],
    });

    const serve = vi.fn<DenoServeFunction>();
    const app = await bootstrapDenoApplication(AppModule, { serve });

    try {
      const handler = createDenoFetchHandler({ dispatcher: app.dispatcher });
      const response = await handler(new Request('https://runtime.test/health'));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(serve).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects invalid maxBodySize values before creating a handler', () => {
    expect(() => createDenoFetchHandler({
      dispatcher: { async dispatch() {} },
      maxBodySize: Number.NaN,
    })).toThrow(/maxBodySize/i);
  });
});
