import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

import { describe, expect, it } from 'vitest';

import { ExpressHttpApplicationAdapter } from './adapter.js';

describe('ExpressHttpApplicationAdapter.getServer', () => {
  it('returns a Node HTTP or HTTPS server', async () => {
    const adapter = new ExpressHttpApplicationAdapter(3000, undefined, 150, 20, undefined);

    try {
      const server: HttpServer | HttpsServer = adapter.getServer();

      expect(server.listening).toBe(false);
    } finally {
      await adapter.close();
    }
  });
});
