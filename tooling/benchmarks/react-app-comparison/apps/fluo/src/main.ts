import '@fluojs/core/metadata-preload';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';

import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import type { ViteDevServer } from 'vite';

import { createBenchmarkModule } from './app';

export const developmentPageModules = [
  './navigation-catalog.ts', './navigation-product.ts', './navigation-jukebox.ts',
  './catalog-destination.tsx',
];

export async function startReactViteApp(vite?: ViteDevServer, upgradeServer?: Server) {
  if (vite && !upgradeServer) throw new Error('The React dev app needs the Vite upgrade source.');
  const manifest: unknown = vite ? undefined : JSON.parse(
    await readFile(new URL('../client/.vite/manifest.json', import.meta.url), 'utf8'),
  );
  const AppModule = createBenchmarkModule(manifest, new URL('../client/', import.meta.url), vite);
  const port = vite ? 0 : Number(process.env.PORT ?? '3000');
  const adapter = FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port,
    configureFastify(instance) {
      instance.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' },
        (_request, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(body.toString())));
        });
      if (vite) instance.addHook('onRequest', (request, reply, done) => {
        if (request.raw.method !== 'GET' || !/^\/(?:src|node_modules|@id|@fs|@vite|@react-refresh)(?:\/|\?|$)/u.test(request.raw.url ?? '')) {
          done();
          return;
        }
        reply.hijack();
        vite.middlewares(request.raw, reply.raw, (error: unknown) => {
          reply.raw.statusCode = error ? 500 : 404;
          reply.raw.end(error instanceof Error ? error.message : 'Asset not found.');
        });
      });
    },
  });
  const app = await FluoFactory.create(AppModule, {
    securityHeaders: vite ? { contentSecurityPolicy: "default-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:" } : undefined,
    adapter,
  });

  await app.listen();
  if (!vite) console.log('BENCH_READY');
  return vite ? { close: () => app.close(), url: adapter.getListenTarget().url } : app;
}

if (process.env.FLUO_REACT_VITE_DEV !== '1') await startReactViteApp();
