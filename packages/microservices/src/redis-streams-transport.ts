import type { MicroserviceTransport, TransportHandler } from './types.js';

interface StreamReadGroupResult {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface RedisStreamClientLike {
  xadd(stream: string, fields: Record<string, string>): Promise<string>;
  xreadgroup(
    group: string,
    consumer: string,
    streams: readonly string[],
    options?: { blockMs?: number; count?: number },
  ): Promise<readonly StreamReadGroupResult[] | null>;
  xack(stream: string, group: string, id: string): Promise<void>;
  xgroupCreate(stream: string, group: string, startId: string, mkstream: boolean): Promise<void>;
  xgroupDestroy(stream: string, group: string): Promise<void>;
}

export interface RedisStreamsMicroserviceTransportOptions {
  readerClient: RedisStreamClientLike;
  writerClient: RedisStreamClientLike;
  consumerGroup?: string;
  namespace?: string;
  requestTimeoutMs?: number;
  pollBlockMs?: number;
}

interface RedisStreamTransportMessage {
  readonly error?: string;
  readonly kind: 'event' | 'message' | 'response';
  readonly pattern: string;
  readonly payload?: unknown;
  readonly replyStream?: string;
  readonly requestId?: string;
}

interface PendingRequest {
  reject(error: unknown): void;
  resolve(value: unknown): void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class RedisStreamsMicroserviceTransport implements MicroserviceTransport {
  private closing = false;
  private readonly consumerId: string;
  private handler: TransportHandler | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private pollPromises: Promise<void>[] = [];

  private readonly namespace: string;
  private readonly consumerGroup: string;
  private readonly requestTimeoutMs: number;
  private readonly pollBlockMs: number;

  constructor(private readonly options: RedisStreamsMicroserviceTransportOptions) {
    this.consumerId = crypto.randomUUID();
    this.namespace = options.namespace ?? 'konekti:streams';
    this.consumerGroup = options.consumerGroup ?? 'konekti-handlers';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.pollBlockMs = options.pollBlockMs ?? 500;
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
      await this.options.readerClient.xgroupCreate(this.messageStream, this.messageGroup, '$', true);
      await this.options.readerClient.xgroupCreate(this.eventStream, this.eventGroup, '$', true);
      await this.options.readerClient.xgroupCreate(this.responseStream, this.responseGroup, '$', true);

      this.pollPromises = [
        this.pollStream(this.messageStream, this.messageGroup),
        this.pollStream(this.eventStream, this.eventGroup),
        this.pollStream(this.responseStream, this.responseGroup),
      ];

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
      throw new Error('RedisStreamsMicroserviceTransport is closing. Wait for close() to complete before send().');
    }

    if (!this.listening) {
      throw new Error('RedisStreamsMicroserviceTransport is not listening. Call listen() before send().');
    }

    const requestId = crypto.randomUUID();

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
        entry.reject(new Error(`Redis Streams request timed out after ${String(this.requestTimeoutMs)}ms waiting for pattern "${pattern}".`));
      }, this.requestTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          entry.reject(new Error('Redis Streams request aborted before publish.'));
          return;
        }

        abortHandler = () => {
          entry.reject(new Error('Redis Streams request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void Promise.resolve().then(async () => {
        if (this.closing) {
          entry.reject(new Error('Redis Streams microservice transport closed before request dispatch.'));
          return;
        }

        const frame = {
          kind: 'message',
          pattern,
          payload,
          replyStream: this.responseStream,
          requestId,
        } satisfies RedisStreamTransportMessage;

        await this.options.writerClient.xadd(this.messageStream, {
          kind: frame.kind,
          pattern: frame.pattern,
          payload: JSON.stringify(frame.payload),
          replyStream: frame.replyStream,
          requestId: frame.requestId,
        });
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to publish Redis Streams request.'));
      });
    });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    const frame = {
      kind: 'event',
      pattern,
      payload,
    } satisfies RedisStreamTransportMessage;

    await this.options.writerClient.xadd(this.eventStream, {
      kind: frame.kind,
      pattern: frame.pattern,
      payload: JSON.stringify(frame.payload),
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      const settled = await Promise.allSettled(this.pollPromises);

      for (const result of settled) {
        if (result.status === 'rejected') {
          closeError ??= result.reason;
        }
      }

      try {
        await this.options.readerClient.xgroupDestroy(this.eventStream, this.eventGroup);
      } catch (error) {
        closeError ??= error;
      }

      try {
        await this.options.readerClient.xgroupDestroy(this.responseStream, this.responseGroup);
      } catch (error) {
        closeError ??= error;
      }
    } finally {
      this.listening = false;
      this.handler = undefined;
      this.pollPromises = [];

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('Redis Streams microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async pollStream(stream: string, group: string): Promise<void> {
    while (!this.closing) {
      try {
        const entries = await this.options.readerClient.xreadgroup(group, this.consumerId, [stream], {
          blockMs: this.pollBlockMs,
          count: 10,
        });

        if (!entries || entries.length === 0) {
          await delay(this.pollBlockMs);
          continue;
        }

        for (const entry of entries) {
          const parsed = this.parseFields(entry.fields);

          if (parsed) {
            if (stream === this.messageStream) {
              this.handleInboundRequest(parsed);
            } else if (stream === this.eventStream) {
              this.handleInboundEvent(parsed);
            } else if (stream === this.responseStream) {
              this.handleInboundResponse(parsed);
            }
          }

          await this.options.readerClient.xack(stream, group, entry.id);
        }
      } catch {
        if (!this.closing) {
          await delay(this.pollBlockMs);
        }
      }
    }
  }

  private handleInboundRequest(message: RedisStreamTransportMessage): void {
    if (!this.handler) {
      return;
    }

    if (message.kind !== 'message' || !message.requestId) {
      return;
    }

    const requestId = message.requestId;
    const replyStream = message.replyStream && message.replyStream.length > 0
      ? message.replyStream
      : this.responseStream;

    void Promise.resolve().then(async () => {
      if (!this.handler) {
        return;
      }

      try {
        const payload = await this.handler({
          kind: 'message',
          pattern: message.pattern,
          payload: message.payload,
          requestId: message.requestId,
        });

        await this.options.writerClient.xadd(replyStream, {
          kind: 'response',
          pattern: message.pattern,
          payload: JSON.stringify(payload),
          requestId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';

        await this.options.writerClient.xadd(replyStream, {
          error: errorMessage,
          kind: 'response',
          pattern: message.pattern,
          requestId,
        });
      }
    }).catch(() => undefined);
  }

  private handleInboundEvent(message: RedisStreamTransportMessage): void {
    if (!this.handler) {
      return;
    }

    if (message.kind !== 'event') {
      return;
    }

    void this.handler({
      kind: 'event',
      pattern: message.pattern,
      payload: message.payload,
    }).catch((error) => {
      this.logEventHandlerFailure(error);
    });
  }

  private handleInboundResponse(message: RedisStreamTransportMessage): void {
    if (message.kind !== 'response' || !message.requestId) {
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

  private parseFields(fields: Readonly<Record<string, string>>): RedisStreamTransportMessage | undefined {
    const kind = fields.kind;
    const pattern = fields.pattern;

    if (kind !== 'event' && kind !== 'message' && kind !== 'response') {
      return undefined;
    }

    if (!pattern) {
      return undefined;
    }

    let payload: unknown;

    if (fields.payload !== undefined) {
      try {
        payload = JSON.parse(fields.payload);
      } catch {
        return undefined;
      }
    }

    return {
      error: fields.error,
      kind,
      pattern,
      payload,
      replyStream: fields.replyStream,
      requestId: fields.requestId,
    };
  }

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][RedisStreamsMicroserviceTransport] event handler failed:', error);
  }

  private get messageStream(): string {
    return `${this.namespace}:messages`;
  }

  private get eventStream(): string {
    return `${this.namespace}:events`;
  }

  private get responseStream(): string {
    return `${this.namespace}:responses:${this.consumerId}`;
  }

  private get messageGroup(): string {
    return this.consumerGroup;
  }

  private get eventGroup(): string {
    return `${this.consumerGroup}:events:${this.consumerId}`;
  }

  private get responseGroup(): string {
    return `${this.consumerGroup}:responses:${this.consumerId}`;
  }
}
