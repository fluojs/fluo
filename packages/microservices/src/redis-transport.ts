import type { MicroserviceTransport, TransportHandler, TransportPacket } from './types.js';

interface RedisPubSubMessage {
  error?: string;
  kind: 'event' | 'message' | 'response';
  pattern: string;
  payload?: unknown;
  requestId?: string;
}

interface RedisLike {
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
  private readonly namespace: string;
  private readonly pending = new Map<string, { reject: (error: unknown) => void; resolve: (value: unknown) => void }>();

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
      this.options.subscribeClient.on('message', (channel, message) => {
        void this.handleIncoming(channel, message);
      });

      await this.options.subscribeClient.subscribe(
        this.requestChannel,
        this.responseChannel,
        this.eventChannel,
      );
      this.listening = true;
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
    throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use TCP transport for send().');
  }

  async close(): Promise<void> {
    if (this.listenPromise) {
      await this.listenPromise;
    }

    if (this.listening) {
      await this.options.subscribeClient.unsubscribe(
        this.requestChannel,
        this.responseChannel,
        this.eventChannel,
      );
    }

    this.listening = false;
    this.handler = undefined;

    for (const [requestId, entry] of this.pending) {
      this.pending.delete(requestId);
      entry.reject(new Error('Redis microservice transport closed before response.'));
    }
  }

  private async handleIncoming(channel: string, rawMessage: string): Promise<void> {
    let message: RedisPubSubMessage;

    try {
      message = JSON.parse(rawMessage) as RedisPubSubMessage;
    } catch {
      return;
    }

    if (channel === this.responseChannel) {
      await this.handleResponse(message);
      return;
    }

    if (!this.handler) {
      return;
    }

    if (channel === this.eventChannel && message.kind === 'event') {
      await this.handler({
        kind: 'event',
        pattern: message.pattern,
        payload: message.payload,
      });
      return;
    }

    if (channel === this.requestChannel && message.kind === 'message' && message.requestId) {
      await this.handleRequest(message);
    }
  }

  private async handleRequest(message: RedisPubSubMessage): Promise<void> {
    if (!this.handler || !message.requestId) {
      return;
    }

    try {
      const payload = await this.handler({
        kind: 'message',
        pattern: message.pattern,
        payload: message.payload,
        requestId: message.requestId,
      } satisfies TransportPacket);

      await this.options.publishClient.publish(this.responseChannel, JSON.stringify({
        kind: 'response',
        pattern: message.pattern,
        payload,
        requestId: message.requestId,
      } satisfies RedisPubSubMessage));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';
      await this.options.publishClient.publish(this.responseChannel, JSON.stringify({
        error: errorMessage,
        kind: 'response',
        pattern: message.pattern,
        requestId: message.requestId,
      } satisfies RedisPubSubMessage));
    }
  }

  private async handleResponse(message: RedisPubSubMessage): Promise<void> {
    if (!message.requestId) {
      return;
    }

    const pending = this.pending.get(message.requestId);

    if (!pending) {
      return;
    }

    this.pending.delete(message.requestId);

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message.payload);
  }

  private get requestChannel(): string {
    return `${this.namespace}:requests`;
  }

  private get responseChannel(): string {
    return `${this.namespace}:responses`;
  }

  private get eventChannel(): string {
    return `${this.namespace}:events`;
  }
}
