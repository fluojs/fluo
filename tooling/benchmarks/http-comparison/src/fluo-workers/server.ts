import { CloudflareWorkerApplicationHost } from '@fluojs/platform-cloudflare-workers';
import { readAppShape, resolveAppModule } from '../shared/fluo-app';

const host = CloudflareWorkerApplicationHost.create<{ BENCH_APP_SHAPE: string }>({
  fromEnv: (env) => ({ rootModule: resolveAppModule(readAppShape(env.BENCH_APP_SHAPE)) }),
});

// Wrangler supplies the real workerd executionContext; never fabricate it.
export default { fetch: host.fetch };
