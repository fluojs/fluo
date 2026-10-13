import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { ResponseModule } from './fixtures';

const port = Number(process.env.PORT);
const host = process.env.BENCH_BIND_HOST;
if (!host || !Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new RangeError('Explicit BENCH_BIND_HOST and valid PORT are required');
}
const app = await FluoFactory.create(ResponseModule, {
  adapter: NodeHttpApplicationAdapter.create({ port, host }),
});
await app.listen();
process.stdout.write(`#3939 listening on :${port}\n`);
