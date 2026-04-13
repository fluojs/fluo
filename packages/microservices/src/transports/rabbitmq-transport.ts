import type { MicroserviceTransport, TransportHandler } from '../types.js';

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

/** Options for configuring the RabbitMQ microservice transport. */
export interface RabbitMqMicroserviceTransportOptions {
  consumer: RabbitMqConsumerLike;
  eventQueue?: string;
  messageQueue?: string;
  publisher: RabbitMqPublisherLike;
  requestTimeoutMs?: number;
  responseQueue?: string;
}

/**
 * RabbitMQ transport for queue-backed request-response and event delivery.
 *
 * The adapter uses dedicated event, message, and response queues so applications can keep
 * a queue-oriented topology while still consuming the generic Fluo transport API.
 */
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

  /**
   * Creates a RabbitMQ transport with explicit consumer and publisher collaborators.
   *
   * @param options Queue names and timeout settings for request-response traffic.
   */
  constructor(private readonly options: RabbitMqMicroserviceTransportOptions) {
    this.eventQueue = options.eventQueue ?? 'fluo.microservices.events';
    this.messageQueue = options.messageQueue ?? 'fluo.microservices.messages';
    this.responseQueue = options.responseQueue ?? `fluo.microservices.responses.${crypto.randomUUID()}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  /**
   * Starts consuming the configured event, message, and response queues.
   *
   * @param handler Runtime callback invoked for inbound event and message packets.
   * @returns A promise that resolves once queue consumers are registered.
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
      const queues = new Set([this.eventQueue, this.messageQueue, this.responseQueue]);

      try {
        for (const queue of queues) {
          await this.options.consumer.consume(queue, (message) => {
            void this.handleInboundMessage(message).catch(() => undefined);
          });

          this.subscribedQueues.add(queue);
        }
      } catch (error) {
        for (const queue of this.subscribedQueues) {
          await this.options.consumer.cancel(queue).catch(() => undefined);
        }

        this.subscribedQueues.clear();

        throw error;
      }

      this.listening = true;
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  /**
   * Sends one request-response message through RabbitMQ.
   *
   * @param pattern Pattern identifying the remote message handler.
   * @param payload Serializable request payload.
   * @param signal Optional abort signal used to cancel the request.
   * @returns The remote handler response payload.
   */
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

  /**
   * Emits one fire-and-forget event through RabbitMQ.
   *
   * @param pattern Pattern identifying the remote event handler.
   * @param payload Serializable event payload.
   * @returns A promise that resolves once the event is published.
   */
  async emit(pattern: string, payload: unknown): Promise<void> {
    const message: RabbitMqTransportMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    await this.options.publisher.publish(this.eventQueue, JSON.stringify(message));
  }

  /**
   * Cancels queue consumers and rejects any in-flight requests.
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
        for (const queue of this.subscribedQueues) {
          try {
            await this.options.consumer.cancel(queue);
          } catch (error) {
            closeError ??= error;
          }
        }
      }
    } finally {
      this.subscribedQueues.clear();
      this.rejectPendingRequests(new Error('RabbitMQ microservice transport closed before response.'));
      this.listening = false;
      this.handler = undefined;
    }

    if (closeError) {
      throw closeError;
    }
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
