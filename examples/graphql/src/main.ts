import { FluoFactory } from '@fluojs/runtime';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger } from '@fluojs/platform-nodejs';

import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: NodeHttpApplicationAdapter.create({
    port: 3000,
  }),
  logger: createConsoleApplicationLogger(),
});
await app.listen();
