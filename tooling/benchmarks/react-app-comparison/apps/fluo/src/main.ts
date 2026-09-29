import { readFile } from 'node:fs/promises';

import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { createBenchmarkModule } from './app';

const manifest: unknown = JSON.parse(
  await readFile(new URL('../client/.vite/manifest.json', import.meta.url), 'utf8'),
);
const AppModule = createBenchmarkModule(manifest, new URL('../client/', import.meta.url));
const port = Number(process.env.PORT ?? '3000');
const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port,
    configureFastify(instance) {
      instance.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' },
        (_request, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(body.toString())));
        });
    },
  }),
});

await app.listen();
console.log('BENCH_READY');
