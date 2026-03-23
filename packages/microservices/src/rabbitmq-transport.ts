import type { MicroserviceTransport, TransportHandler } from './types.js';

interface RabbitMqConsumerLike {
  consume(queue: string, handler: (message: string) => Promise<void> | void): Promise<void>;
  cancel(queue: string): Promise<void>;
}

interface RabbitMqPublisherLike {
  publish(queue: string, message: string): Promise<void>;
}

interface RabbitMqTransportMessage {
  readonly kind: 'event' | 'message';
  readonly pattern: string;
  readonly payload: unknown;
}

export interface RabbitMqMicroserviceTransportOptions {
  consumer: RabbitMqConsumerLike;
  eventQueue?: string;
  messageQueue?: string;
  publisher: RabbitMqPublisherLike;
}

export class RabbitMqMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly eventQueue: string;

  constructor(private readonly options: RabbitMqMicroserviceTransportOptions) {
    this.eventQueue = options.eventQueue ?? 'konekti.microservices.events';
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
      await this.options.consumer.consume(this.eventQueue, (message) => {
        void this.handleInboundMessage(message, 'event').catch(() => undefined);
      });

      this.listening = true;
    })();

    try {
      await this.listenPromise;
    } finally {
      this.listenPromise = undefined;
    }
  }

  async send(_pattern: string, _payload: unknown): Promise<unknown> {
    throw new Error(
      'RabbitMqMicroserviceTransport does not support request/reply send(). Use TCP or NATS transport for send().',
    );
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
      await this.options.consumer.cancel(this.eventQueue);
    }

    this.listening = false;
    this.handler = undefined;
  }

  private async handleInboundMessage(rawMessage: string, expectedKind: 'event' | 'message'): Promise<void> {
    if (!this.handler) {
      return;
    }

    let message: RabbitMqTransportMessage;

    try {
      message = JSON.parse(rawMessage) as RabbitMqTransportMessage;
    } catch {
      return;
    }

    if (message.kind !== expectedKind) {
      return;
    }

    await this.handler({
      kind: message.kind,
      pattern: message.pattern,
      payload: message.payload,
    });
  }
}
