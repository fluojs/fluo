import { defineModule } from '@fluojs/runtime';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import { expect, it } from 'vitest';

import { createExpressTestApplication } from '../../packages/platform-express/src/test-support/application.js';
import { createFastifyTestApplication } from '../../packages/platform-fastify/src/test-support/application.js';
import { createNodeTestApplication } from '../../packages/platform-nodejs/src/test-support/application.js';

it.each([
  { name: 'Node', create: createNodeTestApplication },
  { name: 'Express', create: createExpressTestApplication },
  { name: 'Fastify', create: createFastifyTestApplication },
])('$name test listeners bind the IPv4 origin used by their clients', async ({ create }) => {
  class AppModule {}
  defineModule(AppModule, {});
  const app = await create(AppModule, { port: 0 });

  try {
    await app.listen();
    const adapter = await app.get(HTTP_APPLICATION_ADAPTER);
    const server = adapter.getServer?.();
    if (typeof server !== 'object' || server === null || !('address' in server)
      || typeof server.address !== 'function') {
      throw new TypeError('Expected a bound test server.');
    }
    expect(server.address()).toMatchObject({
      address: '127.0.0.1',
      family: 'IPv4',
    });
  } finally {
    await app.close();
  }
});
