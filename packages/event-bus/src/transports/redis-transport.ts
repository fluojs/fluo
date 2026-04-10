import type { Redis } from 'ioredis';

import type { EventBusTransport } from '../types.js';

/** Clients used by {@link RedisEventBusTransport} for publish and subscribe responsibilities. */
export interface RedisEventBusTransportOptions {
  publishClient: Redis;
  subscribeClient: Redis;
}

/**
 * Redis Pub/Sub transport adapter for cross-process event fan-out.
 *
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { RedisEventBusTransport } from '@fluojs/event-bus/redis';
 *
 * const publishClient = new Redis();
 * const subscribeClient = new Redis();
 *
 * const transport = new RedisEventBusTransport({ publishClient, subscribeClient });
 * ```
 */
export class RedisEventBusTransport implements EventBusTransport {
  private readonly publishClient: Redis;
  private readonly subscribeClient: Redis;
  private readonly handlersByChannel = new Map<string, (payload: unknown) => Promise<void>>();
  private messageListenerAttached = false;

  /**
   * Creates a Redis-backed event-bus transport.
   *
   * @param options Redis clients dedicated to publish and subscribe operations.
   */
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

  /**
   * Publishes one event payload to a Redis Pub/Sub channel.
   *
   * @param channel Channel name derived from the event type.
   * @param payload Serializable event payload.
   * @returns A promise that resolves once Redis accepts the publication.
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    await this.publishClient.publish(channel, JSON.stringify(payload));
  }

  /**
   * Subscribes one local handler to a Redis Pub/Sub channel.
   *
   * @param channel Channel name to subscribe to.
   * @param handler Async handler invoked with JSON-decoded payloads.
   * @returns A promise that resolves once Redis confirms the subscription.
   */
  async subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void> {
    this.handlersByChannel.set(channel, handler);
    await this.subscribeClient.subscribe(channel);

    if (!this.messageListenerAttached) {
      this.subscribeClient.on('message', this.onMessage);
      this.messageListenerAttached = true;
    }
  }

  /**
   * Unsubscribes all tracked channels and detaches the Redis message listener.
   *
   * @returns A promise that resolves once the transport cleanup finishes.
   */
  async close(): Promise<void> {
    let closeError: unknown;
    const channels = [...this.handlersByChannel.keys()];

    try {
      if (channels.length > 0) {
        await this.subscribeClient.unsubscribe(...channels);
      }
    } catch (error) {
      closeError = error;
    } finally {
      this.handlersByChannel.clear();
      if (this.messageListenerAttached) {
        this.subscribeClient.off('message', this.onMessage);
        this.messageListenerAttached = false;
      }
    }

    if (closeError) {
      throw closeError;
    }
  }
}
