import { readFile } from 'node:fs/promises';

import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { createReactViteExampleModule } from './app';

const manifest: unknown = JSON.parse(
  await readFile(new URL('../client/.vite/manifest.json', import.meta.url), 'utf8'),
);
const AppModule = createReactViteExampleModule({
  clientDirectory: new URL('../client/', import.meta.url),
  manifest,
});
const port = Number(process.env.REACT_VITE_EXAMPLE_PORT ?? '3000');
const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ host: '127.0.0.1', port }),
});

await app.listen();
