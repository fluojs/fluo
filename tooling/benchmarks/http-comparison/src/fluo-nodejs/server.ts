import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { readAppShape, resolveAppModule } from '../shared/fluo-app.js';

const port = Number(process.env.PORT);
const app = await FluoFactory.create(resolveAppModule(readAppShape(process.env.BENCH_APP_SHAPE)), {
  adapter: NodeHttpApplicationAdapter.create({ port }),
});
await app.listen();
process.stdout.write(`fluo+Node listening on :${port}\n`);
