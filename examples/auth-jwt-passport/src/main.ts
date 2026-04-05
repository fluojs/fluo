import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

// This example intentionally stays on the default Node.js + Fastify path.
// Official runtime support also includes Bun, Deno, and Cloudflare Workers
// through their dedicated @konekti/platform-* packages.

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
