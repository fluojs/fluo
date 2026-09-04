import { bootstrapNodeApplication } from '@fluojs/runtime/node';

import { AppModule } from './app';

const app = await bootstrapNodeApplication(AppModule, { port: 3000 });
await app.listen();
