import {
  createStaticAssetsMiddleware,
  type StaticAssetSource,
} from '@fluojs/http';
import { bootstrapExpressApplication } from '@fluojs/platform-express';
import { bootstrapFastifyApplication } from '@fluojs/platform-fastify';
import { bootstrapNodejsApplication } from '@fluojs/platform-nodejs';
import { defineModule, type Application, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

type BootstrapStaticAssetsApplication = (
  rootModule: ModuleType,
  options: {
    cors: false;
    middleware: [ReturnType<typeof createStaticAssetsMiddleware>];
    port: 0;
  },
) => Promise<Application>;

class StaticAssetsModule {}
defineModule(StaticAssetsModule, {});

function createAssetSource(): StaticAssetSource {
  return {
    async resolve(path) {
      if (path !== 'app.js') {
        return undefined;
      }

      return {
        contentType: 'application/javascript',
        size: 6,
        source: Uint8Array.from([0, 1, 2, 3, 4, 5]),
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
): Promise<void> {
  const app = await bootstrap(StaticAssetsModule, {
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
    expect(full.headers.get('cache-control')).toBe('public, max-age=300');
    expect(full.headers.get('content-type')).toContain('application/javascript');
    await expect(full.bytes()).resolves.toEqual(Uint8Array.from([0, 1, 2, 3, 4, 5]));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-4/6');
    await expect(ranged.bytes()).resolves.toEqual(Uint8Array.from([2, 3, 4]));
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe('"asset-v1"');
    expect(await notModified.text()).toBe('');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('6');
    expect(await head.text()).toBe('');
  } finally {
    await app.close();
  }
}

describe('static asset real-listener portability', () => {
  it('serves static assets through the Node listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapNodejsApplication);
  });

  it('serves static assets through the Express listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapExpressApplication);
  });

  it('serves static assets through the Fastify listener', async () => {
    await assertStaticAssetsOverRealListener(bootstrapFastifyApplication);
  });
});
