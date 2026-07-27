import type { HttpApplicationAdapter } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { OnMessage, WebSocketGateway } from '../decorators.js';
import {
  type BunWebSocketBinding,
  type BunWebSocketBindingHost,
  BunWebSocketModule,
} from './bun.js';

const BUN_WEBSOCKET_CAPABILITY_REASON =
  'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @fluojs/websockets/bun for the official raw websocket binding.';

class TestBunBindingAdapter implements HttpApplicationAdapter, BunWebSocketBindingHost {
  nativeBackpressureConfigured = false;

  configureWebSocketBinding<TData>(binding: BunWebSocketBinding<TData> | undefined): void {
    this.nativeBackpressureConfigured = binding?.websocket.backpressureLimit !== undefined
      || binding?.websocket.closeOnBackpressureLimit !== undefined;
  }

  getRealtimeCapability() {
    return {
      contract: 'raw-websocket-expansion' as const,
      kind: 'fetch-style' as const,
      mode: 'request-upgrade' as const,
      reason: BUN_WEBSOCKET_CAPABILITY_REASON,
      support: 'supported' as const,
      version: 1 as const,
    };
  }

  getServer(): undefined {
    return undefined;
  }

  async listen(): Promise<void> {}

  async close(): Promise<void> {}
}

describe('@fluojs/websockets/bun backpressure boundary', () => {
  it('keeps Node room backpressure options out of the Bun binding', async () => {
    // Given: a Bun gateway configured with the shared Node room backpressure options.
    const adapter = new TestBunBindingAdapter();

    @WebSocketGateway({ path: '/room-backpressure-boundary' })
    class RoomGateway {
      @OnMessage('ping')
      onPing() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [BunWebSocketModule.forRoot({
        backpressure: {
          maxBufferedAmountBytes: 1,
          policy: 'close',
        },
      })],
      providers: [RoomGateway],
    });

    // When: the Bun lifecycle service installs its native binding.
    const app = await bootstrapApplication({ adapter, rootModule: AppModule });

    try {
      // Then: Node-only room backpressure options do not reach the Bun host.
      expect(adapter.nativeBackpressureConfigured).toBe(false);
    } finally {
      await app.close();
    }
  });
});
