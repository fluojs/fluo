import type { MicroserviceTransport, TransportHandler } from './types.js';

interface RabbitMqConsumerLike {
  consume(queue: string, handler: (message: string) => Promise<void> | void): Promise<void>;
  cancel(queue: string): Promise<void>;
}

interface RabbitMqPublisherLike {
  publish(queue: string, message: string): Promise<void>;
}

interface RabbitMqTransportMessage {
  readonly error?: string;
  readonly kind: 'event' | 'message' | 'response';
  readonly pattern: string;
  readonly payload?: unknown;
  readonly replyTo?: string;
  readonly requestId?: string;
}

export interface RabbitMqMicroserviceTransportOptions {
  consumer: RabbitMqConsumerLike;
  eventQueue?: string;
  messageQueue?: string;
  publisher: RabbitMqPublisherLike;
  requestTimeoutMs?: number;
  responseQueue?: string;
}

export class RabbitMqMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly eventQueue: string;
  private readonly messageQueue: string;
  private readonly pending = new Map<string, {
    reject: (error: unknown) => void;
    resolve: (value: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly requestTimeoutMs: number;
  private readonly responseQueue: string;
  private readonly subscribedQueues = new Set<string>();

  constructor(private readonly options: RabbitMqMicroserviceTransportOptions) {
    this.eventQueue = options.eventQueue ?? 'konekti.microservices.events';
    this.messageQueue = options.messageQueue ?? 'konekti.microservices.messages';
    this.responseQueue = options.responseQueue ?? 'konekti.microservices.responses';
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
      const queues = new Set([this.eventQueue, this.messageQueue, this.responseQueue]);

      for (const queue of queues) {
        await this.options.consumer.consume(queue, (message) => {
          void this.handleInboundMessage(message).catch(() => undefined);
        });

        this.subscribedQueues.add(queue);
      }

      this.listening = true;
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.listenPromise) {
      await this.listenPromise;
    }

    if (!this.listening) {
      throw new Error('RabbitMqMicroserviceTransport is not listening. Call listen() before send().');
    }

    const requestId = crypto.randomUUID();
    const message: RabbitMqTransportMessage = {
      kind: 'message',
      pattern,
      payload,
      replyTo: this.responseQueue,
      requestId,
    };

    return await new Promise<unknown>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`RabbitMQ request timed out after ${this.requestTimeoutMs}ms waiting for pattern "${pattern}".`));
      }, this.requestTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        this.pending.delete(requestId);

        if (abortHandler && signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      this.pending.set(requestId, {
        reject: (error: unknown) => {
          cleanup();
          reject(error);
        },
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
        timeout,
      });

      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(new Error('RabbitMQ request aborted before publish.'));
          return;
        }

        abortHandler = () => {
          cleanup();
          reject(new Error('RabbitMQ request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void this.options.publisher.publish(this.messageQueue, JSON.stringify(message)).catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to publish RabbitMQ request.'));
      });
    });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    const message: RabbitMqTransportMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    await this.options.publisher.publish(this.eventQueue, JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.listenPromise) {
      await this.listenPromise;
    }

    if (this.listening) {
      for (const queue of this.subscribedQueues) {
        await this.options.consumer.cancel(queue);
      }
    }

    this.subscribedQueues.clear();
    this.rejectPendingRequests(new Error('RabbitMQ microservice transport closed before response.'));
    this.listening = false;
    this.handler = undefined;
  }

  private async handleInboundMessage(rawMessage: string): Promise<void> {

    let message: RabbitMqTransportMessage;

    try {
      message = JSON.parse(rawMessage) as RabbitMqTransportMessage;
    } catch {
      return;
    }

    if (message.kind === 'response') {
      this.handleResponse(message);
      return;
    }

    if (!this.handler) {
      return;
    }

    if (message.kind === 'event') {
      await this.handler({
        kind: 'event',
        pattern: message.pattern,
        payload: message.payload,
      });
      return;
    }

    if (message.kind === 'message' && message.requestId) {
      await this.handleRequest(message);
    }
  }

  private async handleRequest(message: RabbitMqTransportMessage): Promise<void> {
    if (!this.handler || !message.requestId) {
      return;
    }

    const replyQueue = typeof message.replyTo === 'string' && message.replyTo.length > 0
      ? message.replyTo
      : this.responseQueue;

    try {
      const payload = await this.handler({
        kind: 'message',
        pattern: message.pattern,
        payload: message.payload,
        requestId: message.requestId,
      });

      await this.options.publisher.publish(replyQueue, JSON.stringify({
        kind: 'response',
        pattern: message.pattern,
        payload,
        requestId: message.requestId,
      } satisfies RabbitMqTransportMessage));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';

      await this.options.publisher.publish(replyQueue, JSON.stringify({
        error: errorMessage,
        kind: 'response',
        pattern: message.pattern,
        requestId: message.requestId,
      } satisfies RabbitMqTransportMessage));
    }
  }

  private handleResponse(message: RabbitMqTransportMessage): void {
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

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timeout);
      this.pending.delete(requestId);
      entry.reject(error);
    }
  }
}
