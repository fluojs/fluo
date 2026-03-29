import type { MicroserviceTransport, TransportHandler, TransportPacket } from './types.js';

interface RedisPubSubMessage {
  error?: string;
  kind: 'event' | 'message' | 'response';
  pattern: string;
  payload?: unknown;
  requestId?: string;
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
  private readonly pending = new Map<string, { reject: (error: unknown) => void; resolve: (value: unknown) => void; timeout: ReturnType<typeof setTimeout> }>();
  private readonly requestTimeoutMs: number;

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][RedisPubSubMicroserviceTransport] event handler failed:', error);
  }

  constructor(private readonly options: RedisPubSubMicroserviceTransportOptions) {
    this.namespace = options.namespace ?? 'konekti:microservices';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
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
        await this.options.subscribeClient.subscribe(
          this.requestChannel,
          this.responseChannel,
          this.eventChannel,
        );
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
    if (!this.listening) {
      throw new Error('RedisPubSubMicroserviceTransport is not listening. Call listen() before send().');
    }

    const requestId = crypto.randomUUID();
    const message: RedisPubSubMessage = {
      kind: 'message',
      pattern,
      payload,
      requestId,
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Redis request timed out after ${this.requestTimeoutMs}ms waiting for pattern "${pattern}".`));
      }, this.requestTimeoutMs);

      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        clearTimeout(timeout);
        this.pending.delete(requestId);

        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      this.pending.set(requestId, {
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
        reject: (error: unknown) => {
          cleanup();
          reject(error);
        },
        timeout,
      });

      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(new Error('Redis request aborted before publish.'));
          return;
        }

        onAbort = () => {
          cleanup();
          reject(new Error('Redis request aborted.'));
        };

        signal.addEventListener('abort', onAbort, { once: true });
      }

      void this.options.publishClient.publish(this.requestChannel, JSON.stringify(message)).catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to publish Redis request.'));
      });
    });
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

    this.options.subscribeClient.off?.('message', this.messageListener);

    this.listening = false;
    this.handler = undefined;

    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timeout);
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
