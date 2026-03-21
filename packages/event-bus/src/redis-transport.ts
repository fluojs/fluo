import type { Redis } from 'ioredis';

import type { EventBusTransport } from './types.js';

export interface RedisEventBusTransportOptions {
  publishClient: Redis;
  subscribeClient: Redis;
}

export class RedisEventBusTransport implements EventBusTransport {
  private readonly publishClient: Redis;
  private readonly subscribeClient: Redis;

  constructor(options: RedisEventBusTransportOptions) {
    this.publishClient = options.publishClient;
    this.subscribeClient = options.subscribeClient;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.publishClient.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void> {
    await this.subscribeClient.subscribe(channel);

    this.subscribeClient.on('message', (receivedChannel: string, message: string) => {
      if (receivedChannel !== channel) {
        return;
      }

      let payload: unknown;

      try {
        payload = JSON.parse(message) as unknown;
      } catch {
        return;
      }

      void handler(payload);
    });
  }

  async close(): Promise<void> {
    this.subscribeClient.disconnect();
    this.publishClient.disconnect();
  }
}
