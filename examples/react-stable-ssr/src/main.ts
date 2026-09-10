import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({ port: 3000 }),
});
await app.listen();
