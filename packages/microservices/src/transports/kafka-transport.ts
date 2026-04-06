import type { MicroserviceTransport, TransportHandler } from '../types.js';

interface KafkaConsumerLike {
  subscribe(topic: string, handler: (message: string) => Promise<void> | void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}

interface KafkaProducerLike {
  publish(topic: string, message: string): Promise<void>;
}

interface KafkaTransportMessage {
  readonly error?: string;
  readonly kind: 'event' | 'message' | 'response';
  readonly pattern: string;
  readonly payload?: unknown;
  readonly replyTopic?: string;
  readonly requestId?: string;
}

interface PendingRequest {
  reject(error: unknown): void;
  resolve(value: unknown): void;
}

export interface KafkaMicroserviceTransportOptions {
  consumer: KafkaConsumerLike;
  eventTopic?: string;
  messageTopic?: string;
  producer: KafkaProducerLike;
  requestTimeoutMs?: number;
  responseTopic?: string;
}

export class KafkaMicroserviceTransport implements MicroserviceTransport {
  private closing = false;
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly eventTopic: string;
  private readonly messageTopic: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly responseTopic: string;

  constructor(private readonly options: KafkaMicroserviceTransportOptions) {
    this.eventTopic = options.eventTopic ?? 'konekti.microservices.events';
    this.messageTopic = options.messageTopic ?? 'konekti.microservices.messages';
    this.responseTopic = options.responseTopic ?? `konekti.microservices.responses.${crypto.randomUUID()}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.closing = false;
    this.handler = handler;

    if (this.listening) {
      return;
    }

    if (this.listenPromise) {
      await this.listenPromise;
      return;
    }

    this.listenPromise = (async () => {
      const subscribed: string[] = [];

      try {
        await this.options.consumer.subscribe(this.eventTopic, (message) => {
          void this.handleInboundEvent(message).catch(() => undefined);
        });
        subscribed.push(this.eventTopic);

        await this.options.consumer.subscribe(this.messageTopic, (message) => {
          void this.handleInboundRequest(message).catch(() => undefined);
        });
        subscribed.push(this.messageTopic);

        await this.options.consumer.subscribe(this.responseTopic, (message) => {
          void this.handleInboundResponse(message).catch(() => undefined);
        });
        subscribed.push(this.responseTopic);
      } catch (error) {
        for (const topic of subscribed) {
          await this.options.consumer.unsubscribe(topic).catch(() => undefined);
        }

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

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closing) {
      throw new Error('KafkaMicroserviceTransport is closing. Wait for close() to complete before send().');
    }

    if (!this.listening) {
      throw new Error('KafkaMicroserviceTransport is not listening. Call listen() before send().');
    }

    const requestId = crypto.randomUUID();
    const requestMessage: KafkaTransportMessage = {
      kind: 'message',
      pattern,
      payload,
      replyTopic: this.responseTopic,
      requestId,
    };

    return await new Promise<unknown>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }

        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }

        this.pending.delete(requestId);
      };

      const entry: PendingRequest = {
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
        reject: (error: unknown) => {
          cleanup();
          reject(error);
        },
      };

      this.pending.set(requestId, entry);

      timeout = setTimeout(() => {
        entry.reject(new Error(`Kafka request timed out after ${String(this.requestTimeoutMs)}ms waiting for pattern "${pattern}".`));
      }, this.requestTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          entry.reject(new Error('Kafka request aborted before publish.'));
          return;
        }

        abortHandler = () => {
          entry.reject(new Error('Kafka request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void Promise.resolve().then(async () => {
        if (this.closing) {
          entry.reject(new Error('Kafka microservice transport closed before request dispatch.'));
          return;
        }

        await this.options.producer.publish(this.messageTopic, JSON.stringify(requestMessage));
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to publish Kafka request.'));
      });
    });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    const message: KafkaTransportMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    await this.options.producer.publish(this.eventTopic, JSON.stringify(message));
  }

  async close(): Promise<void> {
    this.closing = true;
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      if (this.listening) {
        for (const topic of new Set([this.eventTopic, this.messageTopic, this.responseTopic])) {
          try {
            await this.options.consumer.unsubscribe(topic);
          } catch (error) {
            closeError ??= error;
          }
        }
      }
    } finally {
      this.handler = undefined;
      this.listening = false;

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('Kafka microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async handleInboundEvent(rawMessage: string): Promise<void> {
    if (!this.handler) {
      return;
    }

    const message = this.parseMessage(rawMessage);

    if (!message || message.kind !== 'event') {
      return;
    }

    await this.handler({
      kind: 'event',
      pattern: message.pattern,
      payload: message.payload,
    });
  }

  private async handleInboundRequest(rawMessage: string): Promise<void> {
    if (!this.handler) {
      return;
    }

    const message = this.parseMessage(rawMessage);

    if (!message || message.kind !== 'message' || !message.requestId) {
      return;
    }

    const replyTopic = message.replyTopic && message.replyTopic.length > 0
      ? message.replyTopic
      : this.responseTopic;

    try {
      const payload = await this.handler({
        kind: 'message',
        pattern: message.pattern,
        payload: message.payload,
        requestId: message.requestId,
      });

      await this.options.producer.publish(replyTopic, JSON.stringify({
        kind: 'response',
        pattern: message.pattern,
        payload,
        requestId: message.requestId,
      } satisfies KafkaTransportMessage));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';
      await this.options.producer.publish(replyTopic, JSON.stringify({
        error: errorMessage,
        kind: 'response',
        pattern: message.pattern,
        requestId: message.requestId,
      } satisfies KafkaTransportMessage));
    }
  }

  private async handleInboundResponse(rawMessage: string): Promise<void> {
    const message = this.parseMessage(rawMessage);

    if (!message || message.kind !== 'response' || !message.requestId) {
      return;
    }

    const pending = this.pending.get(message.requestId);

    if (!pending) {
      return;
    }

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message.payload);
  }

  private parseMessage(rawMessage: string): KafkaTransportMessage | undefined {
    let message: unknown;

    try {
      message = JSON.parse(rawMessage);
    } catch {
      return undefined;
    }

    if (!message || typeof message !== 'object') {
      return undefined;
    }

    const candidate = message as Partial<KafkaTransportMessage>;

    if (candidate.kind !== 'event' && candidate.kind !== 'message' && candidate.kind !== 'response') {
      return undefined;
    }

    if (typeof candidate.pattern !== 'string') {
      return undefined;
    }

    if (candidate.error !== undefined && typeof candidate.error !== 'string') {
      return undefined;
    }

    if (candidate.replyTopic !== undefined && typeof candidate.replyTopic !== 'string') {
      return undefined;
    }

    if (candidate.requestId !== undefined && typeof candidate.requestId !== 'string') {
      return undefined;
    }

    return candidate as KafkaTransportMessage;
  }
}
