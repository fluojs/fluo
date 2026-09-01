import {
  createStaticAssetsMiddleware,
  type StaticAssetSource,
} from '@fluojs/http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapExpressApplication } from '@fluojs/platform-express';
import { bootstrapFastifyApplication } from '@fluojs/platform-fastify';
import { bootstrapNodejsApplication } from '@fluojs/platform-nodejs';
import { defineModule, type Application, type ModuleType } from '@fluojs/runtime';
import { createNodeFileSystemAssetSource } from '@fluojs/runtime/node';
import { describe, expect, it } from 'vitest';

type BootstrapStaticAssetsApplication = (
  rootModule: ModuleType,
  options: {
    compression: true;
    configureFastify?: Parameters<typeof bootstrapFastifyApplication>[1]['configureFastify'];
    cors: false;
    middleware: [ReturnType<typeof createStaticAssetsMiddleware>];
    port: 0;
  },
) => Promise<Application>;

class StaticAssetsModule {}
defineModule(StaticAssetsModule, {});

function createAssetSource(): StaticAssetSource {
  const bytes = Uint8Array.from({ length: 2048 }, (_, index) => index % 251);

  return {
    async resolve(path) {
      if (path !== 'app.js') {
        return undefined;
      }

      return {
        contentType: 'application/javascript',
        size: bytes.byteLength,
        source: () => new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        validators: {
          etag: { opaqueValue: 'asset-v1', strength: 'strong' },
          lastModified: new Date('2026-01-01T00:00:00Z'),
        },
      };
    },
  };
}

function getListeningUrl(app: Application): string {
  const adapter = Reflect.get(app, 'adapter');

  if (
    typeof adapter !== 'object'
    || adapter === null
    || !('getListenTarget' in adapter)
    || typeof adapter.getListenTarget !== 'function'
  ) {
    throw new Error('Static asset portability test did not receive a listener target.');
  }

  const target = adapter.getListenTarget();

  if (typeof target !== 'object' || target === null || !('url' in target) || typeof target.url !== 'string') {
    throw new Error('Static asset portability test listener target is invalid.');
  }

  return target.url;
}

async function assertStaticAssetsOverRealListener(
  bootstrap: BootstrapStaticAssetsApplication,
  expectsNativeCompressionGuard = false,
): Promise<void> {
  const app = await bootstrap(StaticAssetsModule, {
    compression: true,
    cors: false,
    middleware: [createStaticAssetsMiddleware({
      cacheControl: 'public, max-age=300',
      prefix: '/assets',
      source: createAssetSource(),
    })],
    port: 0,
  });

  try {
    await app.listen();
    const url = getListeningUrl(app);
    const full = await fetch(`${url}/assets/app.js`);
    const ranged = await fetch(`${url}/assets/app.js`, {
      headers: {
        'If-Range': '"asset-v1"',
        Range: 'bytes=2-4',
      },
    });
    const notModified = await fetch(`${url}/assets/app.js`, {
      headers: { 'If-None-Match': '"asset-v1"' },
    });
    const head = await fetch(`${url}/assets/app.js`, { method: 'HEAD' });

    expect(full.status).toBe(200);
    expect(full.headers.get('cache-control')).toContain('public, max-age=300');
    expect(full.headers.get('content-type')).toContain('application/javascript');
    expect(full.headers.get('content-encoding')).toBeNull();
    expect(full.headers.get('content-length')).toBe('2048');
    expect(full.headers.get('etag')).toBe('"asset-v1"');

    if (expectsNativeCompressionGuard) {
      expect(full.headers.get('cache-control')).toContain('no-transform');
    }
    await expect(full.bytes()).resolves.toEqual(Uint8Array.from({ length: 2048 }, (_, index) => index % 251));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-4/2048');
    expect(ranged.headers.get('content-length')).toBe('3');
    expect(ranged.headers.get('etag')).toBe('"asset-v1"');
    await expect(ranged.bytes()).resolves.toEqual(Uint8Array.from([2, 3, 4]));
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe('"asset-v1"');
    expect(await notModified.text()).toBe('');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('2048');
    expect(await head.text()).toBe('');
  } finally {
    await app.close();
  }
}

describe('static asset real-listener portability', () => {
  it('serves a shipped Node filesystem source through GET, HEAD, 304, range, precompression, and missing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fluo-static-listener-'));
    await writeFile(join(root, 'app.js'), Uint8Array.from({ length: 64 }, (_, index) => index));
    await writeFile(join(root, 'app.js.br'), Uint8Array.from([1, 2, 3, 4]));
    await writeFile(join(root, '.well-known.js'), Uint8Array.from([7]));
    const app = await bootstrapNodejsApplication(StaticAssetsModule, {
      compression: true,
      cors: false,
      middleware: [createStaticAssetsMiddleware({
        dotfiles: 'allow',
        prefix: '/assets',
        source: createNodeFileSystemAssetSource({ precompressed: true, root }),
      })],
      port: 0,
    });

    try {
      await app.listen();
      const url = getListeningUrl(app);
      const full = await fetch(`${url}/assets/app.js`, { headers: { 'accept-encoding': 'identity' } });
      const head = await fetch(`${url}/assets/app.js`, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
      const range = await fetch(`${url}/assets/app.js`, {
        headers: { 'accept-encoding': 'identity', Range: 'bytes=2-4' },
      });
      const notModified = await fetch(`${url}/assets/app.js`, {
        headers: { 'accept-encoding': 'identity', 'if-none-match': full.headers.get('etag') ?? '' },
      });
      const compressedHead = await fetch(`${url}/assets/app.js`, {
        method: 'HEAD',
        headers: { 'accept-encoding': 'br' },
      });
      const compressedRange = await fetch(`${url}/assets/app.js`, {
        headers: { 'accept-encoding': 'br', Range: 'bytes=1-2' },
        method: 'HEAD',
      });
      const malformedRange = await fetch(`${url}/assets/app.js`, {
        headers: { 'accept-encoding': 'identity', Range: 'bytes=0-1,3-4' },
      });
      const unacceptable = await fetch(`${url}/assets/app.js`, {
        headers: { 'accept-encoding': '*;q=0' },
      });
      const dotfile = await fetch(`${url}/assets/.well-known.js`, {
        headers: { 'accept-encoding': 'identity' },
      });
      const missing = await fetch(`${url}/assets/missing.js`);

      expect(full.status).toBe(200);
      expect(full.headers.get('content-length')).toBe('64');
      await expect(full.bytes()).resolves.toEqual(Uint8Array.from({ length: 64 }, (_, index) => index));
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe('64');
      expect(range.status).toBe(206);
      expect(range.headers.get('content-range')).toBe('bytes 2-4/64');
      await expect(range.bytes()).resolves.toEqual(Uint8Array.from([2, 3, 4]));
      expect(notModified.status).toBe(304);
      expect(compressedHead.headers.get('content-encoding')).toBe('br');
      expect(compressedHead.headers.get('vary')).toContain('Accept-Encoding');
      expect(compressedRange.status).toBe(206);
      expect(compressedRange.headers.get('content-encoding')).toBe('br');
      expect(compressedRange.headers.get('content-range')).toBe('bytes 1-2/4');
      expect(compressedRange.headers.get('content-length')).toBe('2');
      expect(malformedRange.status).toBe(200);
      await expect(malformedRange.bytes()).resolves.toEqual(Uint8Array.from({ length: 64 }, (_, index) => index));
      expect(unacceptable.status).toBe(406);
      expect(dotfile.status).toBe(200);
      await expect(dotfile.bytes()).resolves.toEqual(Uint8Array.from([7]));
      expect(missing.status).toBe(404);
    } finally {
      await app.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it('serves static assets through the Node listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapNodejsApplication);
  });

  it('serves static assets through the Express listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapExpressApplication, true);
  });

  it('serves static assets through the Fastify listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapFastifyApplication, true);
  });

  it('keeps streamed static GET, HEAD, 304, and range bytes untouched by Fastify compression-compatible hooks', async () => {
    await assertStaticAssetsOverRealListener(async (rootModule, options) =>
      await bootstrapFastifyApplication(rootModule, {
        ...options,
        configureFastify(app) {
          app.decorateReply('compress', () => {
            throw new Error('Static responses must not call an adapter-specific compression API.');
          });
          app.addHook('onSend', async (_request, reply, payload) => {
            const cacheControl = reply.getHeader('cache-control');
            const value = Array.isArray(cacheControl) ? cacheControl.join(', ') : String(cacheControl ?? '');

            if (/\bno-transform\b/i.test(value)) {
              return payload;
            }

            return 'transformed-by-compression';
          });
        },
      }),
    true);
  });
});
