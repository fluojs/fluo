import { ExpressHttpApplicationAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape, resolveAppModule } from '../shared/fluo-app.js';

const port = Number(process.env.PORT);
const app = await FluoFactory.create(resolveAppModule(readAppShape(process.env.BENCH_APP_SHAPE)), {
  adapter: ExpressHttpApplicationAdapter.create({ port }),
});
await app.listen();
process.stdout.write(`fluo+Express listening on :${port}\n`);
