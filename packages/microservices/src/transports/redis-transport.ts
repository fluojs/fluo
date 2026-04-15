import type { MicroserviceTransport, MicroserviceTransportLogger, TransportHandler } from '../types.js';

interface RedisPubSubMessage {
  kind: 'event';
  pattern: string;
  payload?: unknown;
}

interface RedisLike {
  off?(event: 'message', listener: (channel: string, message: string) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
}

/** Options for configuring the Redis Pub/Sub microservice transport. */
export interface RedisPubSubMicroserviceTransportOptions {
  namespace?: string;
  publishClient: RedisLike;
  requestTimeoutMs?: number;
  subscribeClient: RedisLike;
}

/**
 * Redis Pub/Sub transport for fire-and-forget microservice events.
 *
 * This adapter intentionally supports `emit()` only. Request-response flows must use
 * a transport with durable reply semantics such as TCP, Kafka, or Redis Streams.
 */
export class RedisPubSubMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private logger: MicroserviceTransportLogger | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly messageListener = (channel: string, message: string) => {
    void this.handleIncoming(channel, message);
  };
  private readonly namespace: string;

  private logEventHandlerFailure(error: unknown): void {
    if (this.logger) {
      this.logger.error('Event handler failed.', error, 'RedisPubSubMicroserviceTransport');
      return;
    }

    console.error('[fluo][RedisPubSubMicroserviceTransport] event handler failed:', error);
  }

  /**
   * Creates a Redis Pub/Sub transport using dedicated publish and subscribe clients.
   *
   * @param options Namespace and Redis client settings for the transport.
   */
  constructor(private readonly options: RedisPubSubMicroserviceTransportOptions) {
    this.namespace = options.namespace ?? 'fluo:microservices';
  }

  setLogger(logger: MicroserviceTransportLogger): void {
    this.logger = logger;
  }

  /**
   * Subscribes to the namespaced event channel and registers the runtime handler.
   *
   * @param handler Runtime callback invoked for inbound event packets.
   * @returns A promise that resolves once the Redis subscription is active.
   */
  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;

    if (this.listening) {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = (async () => {
      this.options.subscribeClient.on('message', this.messageListener);

      try {
        await this.options.subscribeClient.subscribe(this.eventChannel);
        this.listening = true;
      } catch (error) {
        this.options.subscribeClient.off?.('message', this.messageListener);
        throw error;
      }
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  /**
   * Publishes one fire-and-forget event through Redis Pub/Sub.
   *
   * @param pattern Pattern identifying the remote event handler.
   * @param payload Serializable payload to publish.
   * @returns A promise that resolves once Redis accepts the publication.
   */
  async emit(pattern: string, payload: unknown): Promise<void> {
    const message: RedisPubSubMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    await this.options.publishClient.publish(this.eventChannel, JSON.stringify(message));
  }

  /**
   * Rejects request-response usage for the Pub/Sub transport.
   *
   * @param pattern Unused request pattern.
   * @param payload Unused request payload.
   * @param signal Unused abort signal.
   * @returns Never resolves successfully.
   * @throws {Error} Always, because Pub/Sub has no reply channel contract.
   */
  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    void pattern;
    void payload;
    void signal;
    throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use emit() or a transport with durable request/reply semantics.');
  }

  /**
   * Unsubscribes from the event channel and detaches the Redis message listener.
   *
   * @returns A promise that resolves once shutdown cleanup completes.
   */
  async close(): Promise<void> {
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      if (this.listening) {
        await this.options.subscribeClient.unsubscribe(this.eventChannel);
      }
    } catch (error) {
      closeError = error;
    } finally {
      this.options.subscribeClient.off?.('message', this.messageListener);
      this.listening = false;
      this.handler = undefined;
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async handleIncoming(channel: string, rawMessage: string): Promise<void> {
    let message: RedisPubSubMessage;

    try {
      message = JSON.parse(rawMessage) as RedisPubSubMessage;
    } catch {
      return;
    }

    if (!this.handler) {
      return;
    }

    if (channel === this.eventChannel && message.kind === 'event') {
      try {
        await this.handler({
          kind: 'event',
          pattern: message.pattern,
          payload: message.payload,
        });
      } catch (error) {
        this.logEventHandlerFailure(error);
      }
      return;
    }

  }

  private get eventChannel(): string {
    return `${this.namespace}:events`;
  }
}
