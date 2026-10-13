import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape, resolveAppModule } from '../shared/fluo-app.js';

const port = Number(process.env.PORT ?? 3001);
const app = await FluoFactory.create(resolveAppModule(readAppShape(process.env.BENCH_APP_SHAPE)), {
  adapter: FastifyHttpApplicationAdapter.create({ port, host: process.env.BENCH_BIND_HOST }),
});
await app.listen();
process.stdout.write(`fluo listening on :${port}\n`);
