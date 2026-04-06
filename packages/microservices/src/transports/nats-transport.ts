import type { MicroserviceTransport, TransportHandler } from '../types.js';

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

interface PendingRequest {
  reject(error: unknown): void;
  resolve(value: unknown): void;
}

export class NatsMicroserviceTransport implements MicroserviceTransport {
  private closing = false;
  private handler: TransportHandler | undefined;
  private listening = false;
  private readonly eventSubject: string;
  private readonly messageSubject: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private subscriptions: NatsSubscriptionLike[] = [];

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][NatsMicroserviceTransport] event handler failed:', error);
  }

  private handleEventMessageSafely(message: NatsMessageLike): void {
    void this.handleEventMessage(message).catch((error) => {
      this.logEventHandlerFailure(error);
    });
  }

  constructor(private readonly options: NatsMicroserviceTransportOptions) {
    this.eventSubject = options.eventSubject ?? 'konekti.microservices.events';
    this.messageSubject = options.messageSubject ?? 'konekti.microservices.messages';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  async listen(handler: TransportHandler): Promise<void> {
    this.closing = false;
    this.handler = handler;

    if (this.listening) {
      return;
    }

    const eventSubscription = this.options.client.subscribe(this.eventSubject, (message) => {
      this.handleEventMessageSafely(message);
    });
    const messageSubscription = this.options.client.subscribe(this.messageSubject, (message) => {
      void this.handleRequestMessage(message);
    });

    this.subscriptions = [eventSubscription, messageSubscription];
    this.listening = true;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    if (this.closing) {
      throw new Error('NATS microservice transport is closing. Wait for close() to complete before send().');
    }

    if (!this.listening) {
      throw new Error('NatsMicroserviceTransport is not listening. Call listen() before send().');
    }

    const request: NatsTransportMessage = {
      kind: 'message',
      pattern,
      payload,
    };

    const requestId = crypto.randomUUID();

    return await new Promise<unknown>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (settled) {
          return;
        }

        settled = true;
        this.pending.delete(requestId);
      };

      const entry: PendingRequest = {
        reject: (error: unknown) => {
          cleanup();
          reject(error);
        },
        resolve: (value: unknown) => {
          cleanup();
          resolve(value);
        },
      };

      this.pending.set(requestId, entry);

      void Promise.resolve().then(async () => {
        if (this.closing) {
          entry.reject(new Error('NATS microservice transport closed before request dispatch.'));
          return;
        }

        const responseMessage = await this.options.client.request(
          this.messageSubject,
          this.encode(request),
          { timeout: this.requestTimeoutMs },
        );
        const response = this.decode<NatsTransportResponse>(responseMessage.data);

        if (response.error) {
          entry.reject(new Error(response.error));
          return;
        }

        entry.resolve(response.payload);
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to send NATS request.'));
      });
    });
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
    this.closing = true;
    let closeError: unknown;

    try {
      for (const subscription of this.subscriptions) {
        subscription.unsubscribe();
      }

      this.options.client.close?.();
    } catch (error) {
      closeError = error;
    } finally {
      this.subscriptions = [];
      this.listening = false;
      this.handler = undefined;

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('NATS microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async handleEventMessage(message: NatsMessageLike): Promise<void> {
    if (!this.handler) {
      return;
    }

    const packet = this.decode<NatsTransportMessage>(message.data);

    if (packet.kind !== 'event') {
      return;
    }

    try {
      await this.handler({
        kind: 'event',
        pattern: packet.pattern,
        payload: packet.payload,
      });
    } catch (error) {
      this.logEventHandlerFailure(error);
    }
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
