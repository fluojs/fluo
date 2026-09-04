import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { EventBusModule } from './module.js';
import type { EventBusTransport } from './types.js';

describe('EventBusLifecycleService transport close retry', () => {
  it('propagates a close failure so runtime shutdown retries the incomplete hook', async () => {
    const transport = {
      closeCalls: 0,
      async close() {
        this.closeCalls += 1;

        if (this.closeCalls === 1) {
          throw new Error('transport close failed');
        }
      },
      async publish(_channel: string, _payload: unknown) {},
      async subscribe(_channel: string, _handler: (payload: unknown) => Promise<void>) {},
    } satisfies EventBusTransport & { closeCalls: number };

    class AppModule {}
    defineModule(AppModule, {
      imports: [EventBusModule.forRoot({ transport })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      await expect(app.close()).rejects.toThrow('transport close failed');
      expect(transport.closeCalls).toBe(1);

      await expect(app.close()).resolves.toBeUndefined();
      expect(transport.closeCalls).toBe(2);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
