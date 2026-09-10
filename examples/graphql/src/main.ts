import { FluoFactory } from '@fluojs/runtime';
import { createNodejsAdapter, createConsoleApplicationLogger } from '@fluojs/platform-nodejs';

import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: createNodejsAdapter({
    port: 3000,
  }),
  logger: createConsoleApplicationLogger(),
});
await app.listen();
