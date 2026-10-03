import { readFile } from 'node:fs/promises';

import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { createReactViteExampleModule } from './app';
import { createReactViteExamplePresentation } from './presentation';

const manifest: unknown = JSON.parse(
  await readFile(new URL(process.env.REACT_VITE_EXAMPLE_MANIFEST_URL ?? '../client/.vite/manifest.json', import.meta.url), 'utf8'),
);
const AppModule = createReactViteExampleModule({
  clientDirectory: new URL(process.env.REACT_VITE_EXAMPLE_CLIENT_URL ?? '../client/', import.meta.url),
  presentation: createReactViteExamplePresentation(manifest),
});
const port = Number(process.env.REACT_VITE_EXAMPLE_PORT ?? '3000');
const adapter = FastifyHttpApplicationAdapter.create({
  host: '127.0.0.1', port,
  configureFastify(server) {
    server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      const fields: Record<string, string | string[]> = Object.create(null);
      for (const [name, value] of new URLSearchParams(String(body))) {
        const prior = fields[name];
        fields[name] = prior === undefined ? value : Array.isArray(prior) ? [...prior, value] : [prior, value];
      }
      done(null, fields);
    });
  },
});
const app = await FluoFactory.create(AppModule, {
  ...AppModule.applicationOptions,
  adapter,
});

await app.listen();
if (process.env.REACT_VITE_EXAMPLE_TEST_READY === '1') {
  console.log(`REACT_VITE_EXAMPLE_READY ${adapter.getListenTarget().url}`);
}
