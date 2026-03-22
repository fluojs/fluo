import type { Redis } from 'ioredis';

import type { EventBusTransport } from './types.js';

export interface RedisEventBusTransportOptions {
  publishClient: Redis;
  subscribeClient: Redis;
}

export class RedisEventBusTransport implements EventBusTransport {
  private readonly publishClient: Redis;
  private readonly subscribeClient: Redis;
  private readonly handlersByChannel = new Map<string, (payload: unknown) => Promise<void>>();
  private messageListenerAttached = false;

  constructor(options: RedisEventBusTransportOptions) {
    this.publishClient = options.publishClient;
    this.subscribeClient = options.subscribeClient;
  }

  private readonly onMessage = (receivedChannel: string, message: string): void => {
    const handler = this.handlersByChannel.get(receivedChannel);

    if (!handler) {
      return;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(message) as unknown;
    } catch {
      return;
    }

    void handler(payload);
  };

  async publish(channel: string, payload: unknown): Promise<void> {
    await this.publishClient.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void> {
    this.handlersByChannel.set(channel, handler);
    await this.subscribeClient.subscribe(channel);

    if (!this.messageListenerAttached) {
      this.subscribeClient.on('message', this.onMessage);
      this.messageListenerAttached = true;
    }
  }

  async close(): Promise<void> {
    this.handlersByChannel.clear();
    this.subscribeClient.disconnect();
    this.publishClient.disconnect();
  }
}
