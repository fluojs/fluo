import process from 'node:process';
import { DenoHttpApplicationAdapter } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape, resolveAppModule } from '../shared/fluo-app.js';

// Passed as arguments: package internals do not read environment variables.
const port = Number(process.argv[2]);
const app = await FluoFactory.create(resolveAppModule(readAppShape(process.argv[3])), {
  adapter: DenoHttpApplicationAdapter.create({ port, hostname: process.env.BENCH_BIND_HOST ?? '127.0.0.1' }),
});
await app.listen();
console.log(`fluo+Deno listening on :${port}`);
