import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
