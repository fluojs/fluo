import { ExpressHttpApplicationAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { fixture, fixtureModule } from './fixtures.js';

// The fixture name is replaced by esbuild for each immutable serving entry.
const name = process.env.ISSUE_3942_FIXTURE;
const host = process.env.BENCH_BIND_HOST;
const port = Number(process.env.PORT);
if (!name || !host || !Number.isSafeInteger(port) || port < 0
  || (port === 0 && process.env.ISSUE_3942_CORRECTNESS !== '1')) {
  throw new TypeError('ISSUE_3942_FIXTURE, BENCH_BIND_HOST and positive PORT are required (0 is correctness-only)');
}
const adapter = ExpressHttpApplicationAdapter.create({
  port, host, nativeMiddleware: [...fixture(name).middleware],
});
const app = await FluoFactory.create(fixtureModule(name), {
  adapter,
});
await app.listen();
const address = adapter.getServer()?.address();
if (!address || typeof address === 'string') throw new TypeError('Missing bound listener');
process.stdout.write(`issue-3942 listening on :${address.port}\n`);
