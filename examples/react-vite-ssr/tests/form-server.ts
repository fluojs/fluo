import { readFile } from 'node:fs/promises';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { createReactViteExampleModule } from '../src/app';
import { createReactViteExamplePresentation } from '../src/presentation';
import { FormControl } from './form-control';

const port = Number(process.env.REACT_VITE_EXAMPLE_PORT ?? 43874);
const clientDirectory = new URL('../client/', import.meta.url);
const manifest: unknown = JSON.parse(await readFile(new URL('.vite/manifest.json', clientDirectory), 'utf8'));
const control = new FormControl();
const AppModule = createReactViteExampleModule({
  clientDirectory, presentation: createReactViteExamplePresentation(manifest), catalogControl: control.observe,
});
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
    control.install(server);
  },
});
const app = await FluoFactory.create(AppModule, { ...AppModule.applicationOptions, adapter });
await app.listen();
