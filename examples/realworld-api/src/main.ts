import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

// This example intentionally stays on the default Node.js + Fastify path.
// Official runtime support also includes Bun, Deno, and Cloudflare Workers
// through their dedicated @fluojs/platform-* packages.

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port: 3000 }),
});
await app.listen();
