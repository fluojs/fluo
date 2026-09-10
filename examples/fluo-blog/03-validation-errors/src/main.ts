import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';

import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? '3000'),
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
