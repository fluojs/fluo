import { runFastifyApplication } from '@fluojs/platform-fastify';

import { AppModule } from './app';

await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? '3000'),
});
