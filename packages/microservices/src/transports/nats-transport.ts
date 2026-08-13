import type { MicroserviceTransport, MicroserviceTransportLogger, TransportHandler } from '../types.js';
import { logTransportEventHandlerFailure } from './event-handler-logger.js';

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
  publish(subject: string, payload: Uint8Array): void;
  request(subject: string, payload: Uint8Array, options?: { timeout?: number }): Promise<{ data: Uint8Array }>;
  subscribe(subject: string, handler: (message: NatsMessageLike) => void): NatsSubscriptionLike;
}

/** Options for configuring the NATS microservice transport. */
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

/**
 * NATS transport for request-response messages and fire-and-forget event delivery.
 *
 * The adapter maps Fluo message traffic onto separate event and request subjects while
 * preserving JSON framing and NATS request timeout behavior.
 */
export class NatsMicroserviceTransport implements MicroserviceTransport {
  private closePromise: Promise<void> | undefined;
  private closing = false;
  private handler: TransportHandler | undefined;
  private logger: MicroserviceTransportLogger | undefined;
  private listening = false;
  private readonly eventSubject: string;
  private readonly messageSubject: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private subscriptions: NatsSubscriptionLike[] = [];

  private logEventHandlerFailure(error: unknown): void {
    logTransportEventHandlerFailure(this.logger, 'NatsMicroserviceTransport', error);
  }

  private handleEventMessageSafely(message: NatsMessageLike): void {
    void this.handleEventMessage(message).catch((error) => {
      this.logEventHandlerFailure(error);
    });
  }

  private handleRequestMessageSafely(message: NatsMessageLike): void {
    void this.handleRequestMessage(message).catch((error: unknown) => {
      this.logger?.error('Request callback failed.', error, 'NatsMicroserviceTransport');
    });
  }

  /**
   * Creates a NATS transport using a client and codec supplied by the application.
   *
   * @param options Subject names, codec, client, and request-timeout settings.
   */
  constructor(private readonly options: NatsMicroserviceTransportOptions) {
    this.eventSubject = options.eventSubject ?? 'fluo.microservices.events';
    this.messageSubject = options.messageSubject ?? 'fluo.microservices.messages';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
  }

  setLogger(logger: MicroserviceTransportLogger): void {
    this.logger = logger;
  }

  /**
   * Subscribes to the configured NATS event and message subjects.
   *
   * @param handler Runtime callback invoked for inbound event and message packets.
   * @returns A promise that resolves once subscriptions are active.
   */
  async listen(handler: TransportHandler): Promise<void> {
    if (this.closing) {
      if (this.closePromise) {
        throw new Error('NATS microservice transport is closing. Wait for close() to complete before listen().');
      }

      if (this.subscriptions.length > 0) {
        throw new Error('NATS subscription cleanup is incomplete. Call close() again before listen().');
      }

      this.closing = false;
    }

    this.handler = handler;

    if (this.listening) {
      return;
    }

    try {
      this.subscriptions.push(this.options.client.subscribe(this.eventSubject, (message) => {
        this.handleEventMessageSafely(message);
      }));
      this.subscriptions.push(this.options.client.subscribe(this.messageSubject, (message) => {
        this.handleRequestMessageSafely(message);
      }));
    } catch (error) {
      for (const subscription of this.subscriptions.reverse()) {
        try {
          subscription.unsubscribe();
        } catch {
          // Preserve the original subscription failure; partial setup cleanup is best-effort.
        }
      }

      this.subscriptions = [];
      this.handler = undefined;
      this.listening = false;
      throw error;
    }

    this.listening = true;
  }

  /**
   * Sends one request-response message through NATS request/reply.
   *
   * @param pattern Pattern identifying the remote message handler.
   * @param payload Serializable request payload.
   * @param signal Optional abort signal used to cancel the request.
   * @returns The decoded remote handler response payload.
   */
  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
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
      let abortHandler: (() => void) | undefined;
      let settled = false;

      const cleanup = () => {
        if (settled) {
          return;
        }

        settled = true;

        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }

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

      if (signal) {
        if (signal.aborted) {
          entry.reject(new Error('NATS request aborted before publish.'));
          return;
        }

        abortHandler = () => {
          entry.reject(new Error('NATS request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void Promise.resolve().then(async () => {
        if (settled) {
          return;
        }

        if (signal?.aborted) {
          entry.reject(new Error('NATS request aborted before publish.'));
          return;
        }

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

  /**
   * Emits one fire-and-forget event through the configured NATS event subject.
   *
   * @param pattern Pattern identifying the remote event handler.
   * @param payload Serializable event payload.
   * @returns A promise that resolves once the event is published.
   */
  async emit(pattern: string, payload: unknown): Promise<void> {
    if (this.closing) {
      throw new Error('NATS microservice transport is closing. Wait for close() to complete before emit().');
    }

    const event: NatsTransportMessage = {
      kind: 'event',
      pattern,
      payload,
    };

    this.options.client.publish(this.eventSubject, this.encode(event));
  }

  /**
   * Unsubscribes from NATS subjects without closing the caller-owned client.
   *
   * @returns A promise that resolves once shutdown cleanup completes.
   */
  async close(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    this.closing = true;
    this.closePromise = (async () => {
      const cleanupErrors: unknown[] = [];
      const retainedSubscriptions: NatsSubscriptionLike[] = [];

      for (const subscription of this.subscriptions) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          cleanupErrors.push(error);
          retainedSubscriptions.push(subscription);
        }
      }

      this.subscriptions = retainedSubscriptions;
      this.listening = false;
      this.handler = undefined;

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('NATS microservice transport closed before response.'));
      }

      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }

      if (cleanupErrors.length > 1) {
        throw new AggregateError(
          cleanupErrors,
          'NATS subscription cleanup failed for multiple subscriptions.',
        );
      }
    })();

    try {
      await this.closePromise;
    } finally {
      this.closePromise = undefined;
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

    let response: NatsTransportResponse;

    try {
      response = {
        payload: await this.handler({
          kind: 'message',
          pattern: packet.pattern,
          payload: packet.payload,
        }),
      };
    } catch (error: unknown) {
      response = {
        error: error instanceof Error ? error.message : 'Unhandled microservice error',
      };
    }

    message.respond(this.encode(response));
  }

  private decode<T>(data: Uint8Array): T {
    return JSON.parse(this.options.codec.decode(data)) as T;
  }

  private encode(value: unknown): Uint8Array {
    return this.options.codec.encode(JSON.stringify(value));
  }
}
