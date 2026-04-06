import type { MicroserviceTransport, TransportHandler } from '../types.js';

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

export interface RedisPubSubMicroserviceTransportOptions {
  namespace?: string;
  publishClient: RedisLike;
  requestTimeoutMs?: number;
  subscribeClient: RedisLike;
}

export class RedisPubSubMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly messageListener = (channel: string, message: string) => {
    void this.handleIncoming(channel, message);
  };
  private readonly namespace: string;

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][RedisPubSubMicroserviceTransport] event handler failed:', error);
  }

  constructor(private readonly options: RedisPubSubMicroserviceTransportOptions) {
    this.namespace = options.namespace ?? 'konekti:microservices';
  }

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

  async emit(pattern: string, payload: unknown): Promise<void> {
    const message: RedisPubSubMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    await this.options.publishClient.publish(this.eventChannel, JSON.stringify(message));
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    void pattern;
    void payload;
    void signal;
    throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use emit() or a transport with durable request/reply semantics.');
  }

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
