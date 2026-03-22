import type { MicroserviceTransport, TransportHandler } from './types.js';

interface KafkaConsumerLike {
  subscribe(topic: string, handler: (message: string) => Promise<void> | void): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
}

interface KafkaProducerLike {
  publish(topic: string, message: string): Promise<void>;
}

interface KafkaTransportMessage {
  readonly kind: 'event' | 'message';
  readonly pattern: string;
  readonly payload: unknown;
}

export interface KafkaMicroserviceTransportOptions {
  consumer: KafkaConsumerLike;
  eventTopic?: string;
  messageTopic?: string;
  producer: KafkaProducerLike;
}

export class KafkaMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listening = false;
  private readonly eventTopic: string;
  private readonly messageTopic: string;

  constructor(private readonly options: KafkaMicroserviceTransportOptions) {
    this.eventTopic = options.eventTopic ?? 'konekti.microservices.events';
    this.messageTopic = options.messageTopic ?? 'konekti.microservices.messages';
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;

    if (this.listening) {
      return;
    }

    await this.options.consumer.subscribe(this.eventTopic, async (message) => {
      await this.handleInboundMessage(message, 'event');
    });
    await this.options.consumer.subscribe(this.messageTopic, async (message) => {
      await this.handleInboundMessage(message, 'message');
    });

    this.listening = true;
  }

  async send(_pattern: string, _payload: unknown): Promise<unknown> {
    throw new Error(
      'KafkaMicroserviceTransport does not support request/reply send(). Use TCP or NATS transport for send().',
    );
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
    if (this.listening) {
      await this.options.consumer.unsubscribe(this.eventTopic);
      await this.options.consumer.unsubscribe(this.messageTopic);
    }

    this.handler = undefined;
    this.listening = false;
  }

  private async handleInboundMessage(rawMessage: string, expectedKind: 'event' | 'message'): Promise<void> {
    if (!this.handler) {
      return;
    }

    let message: KafkaTransportMessage;

    try {
      message = JSON.parse(rawMessage) as KafkaTransportMessage;
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
