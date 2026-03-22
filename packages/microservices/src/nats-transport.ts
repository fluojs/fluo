import type { MicroserviceTransport, TransportHandler } from './types.js';

interface NatsMessageLike {
  readonly data: Uint8Array;
  respond(data: Uint8Array): void;
}

interface NatsCodecLike {
  decode(data: Uint8Array): string;
  encode(value: string): Uint8Array;
}

interface NatsSubscriptionLike {
  unsubscribe(): void;
}

interface NatsLike {
  close?(): void;
  publish(subject: string, payload: Uint8Array): void;
  request(subject: string, payload: Uint8Array, options?: { timeout?: number }): Promise<{ data: Uint8Array }>;
  subscribe(subject: string, handler: (message: NatsMessageLike) => void): NatsSubscriptionLike;
}

export interface NatsMicroserviceTransportOptions {
  client: NatsLike;
  codec: NatsCodecLike;
  eventSubject?: string;
  messageSubject?: string;
  requestTimeoutMs?: number;
}

interface NatsTransportMessage {
  readonly kind: 'event' | 'message';
  readonly pattern: string;
  readonly payload: unknown;
}

interface NatsTransportResponse {
  readonly error?: string;
  readonly payload?: unknown;
}

export class NatsMicroserviceTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;
  private listening = false;
  private readonly eventSubject: string;
  private readonly messageSubject: string;
  private readonly requestTimeoutMs: number;
  private subscriptions: NatsSubscriptionLike[] = [];

  constructor(private readonly options: NatsMicroserviceTransportOptions) {
    this.eventSubject = options.eventSubject ?? 'konekti.microservices.events';
    this.messageSubject = options.messageSubject ?? 'konekti.microservices.messages';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;

    if (this.listening) {
      return;
    }

    const eventSubscription = this.options.client.subscribe(this.eventSubject, (message) => {
      void this.handleEventMessage(message);
    });
    const messageSubscription = this.options.client.subscribe(this.messageSubject, (message) => {
      void this.handleRequestMessage(message);
    });

    this.subscriptions = [eventSubscription, messageSubscription];
    this.listening = true;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    const request: NatsTransportMessage = {
      kind: 'message',
      pattern,
      payload,
    };

    const responseMessage = await this.options.client.request(
      this.messageSubject,
      this.encode(request),
      { timeout: this.requestTimeoutMs },
    );
    const response = this.decode<NatsTransportResponse>(responseMessage.data);

    if (response.error) {
      throw new Error(response.error);
    }

    return response.payload;
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    const event: NatsTransportMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    this.options.client.publish(this.eventSubject, this.encode(event));
  }

  async close(): Promise<void> {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions = [];
    this.listening = false;
    this.handler = undefined;
    this.options.client.close?.();
  }

  private async handleEventMessage(message: NatsMessageLike): Promise<void> {
    if (!this.handler) {
      return;
    }

    const packet = this.decode<NatsTransportMessage>(message.data);

    if (packet.kind !== 'event') {
      return;
    }

    await this.handler({
      kind: 'event',
      pattern: packet.pattern,
      payload: packet.payload,
    });
  }

  private async handleRequestMessage(message: NatsMessageLike): Promise<void> {
    if (!this.handler) {
      return;
    }

    const packet = this.decode<NatsTransportMessage>(message.data);

    if (packet.kind !== 'message') {
      return;
    }

    try {
      const payload = await this.handler({
        kind: 'message',
        pattern: packet.pattern,
        payload: packet.payload,
      });
      message.respond(this.encode({ payload } satisfies NatsTransportResponse));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';
      message.respond(this.encode({ error: errorMessage } satisfies NatsTransportResponse));
    }
  }

  private decode<T>(data: Uint8Array): T {
    return JSON.parse(this.options.codec.decode(data)) as T;
  }

  private encode(value: unknown): Uint8Array {
    return this.options.codec.encode(JSON.stringify(value));
  }
}
