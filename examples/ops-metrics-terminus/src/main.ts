import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

const app = await KonektiFactory.create(AppModule, {});
await app.listen();
