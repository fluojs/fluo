import type { MicroserviceTransport, MicroserviceTransportLogger, TransportHandler } from '../types.js';

interface StreamReadGroupResult {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** Optional Redis Streams write controls used for bounded retention. */
export interface RedisStreamWriteOptions {
  /** Approximate maximum stream length preserved by Redis after this append. */
  readonly maxLenApproximate?: number;
}

/** Minimal Redis Streams client contract required by {@link RedisStreamsMicroserviceTransport}. */
export interface RedisStreamClientLike {
  xadd(stream: string, fields: Record<string, string>, options?: RedisStreamWriteOptions): Promise<string>;
  xreadgroup(
    group: string,
    consumer: string,
    streams: readonly string[],
    options?: { blockMs?: number; count?: number },
  ): Promise<readonly StreamReadGroupResult[] | null>;
  xack(stream: string, group: string, id: string): Promise<void>;
  get?(key: string): Promise<string | null>;
  incr?(key: string): Promise<number>;
  decr?(key: string): Promise<number>;
  set?(key: string, value: string): Promise<unknown>;
  xdel?(stream: string, id: string): Promise<void>;
  del?(stream: string): Promise<void>;
  xgroupCreate(stream: string, group: string, startId: string, mkstream: boolean): Promise<void>;
  xgroupDestroy(stream: string, group: string): Promise<void>;
}

/** Options for configuring the Redis Streams microservice transport. */
export interface RedisStreamsMicroserviceTransportOptions {
  readerClient: RedisStreamClientLike;
  writerClient: RedisStreamClientLike;
  /**
   * Approximate maximum request stream length applied at publish time.
   *
   * Disabled by default so pending request entries are never trimmed before `xack`/recovery.
   */
  messageRetentionMaxLen?: number;
  /**
   * Approximate maximum event stream length applied at publish time.
   *
   * Disabled by default so pending event entries are never trimmed before consumer-group recovery.
   */
  eventRetentionMaxLen?: number;
  /** Approximate maximum per-consumer response stream length. Defaults to `1_000`. */
  responseRetentionMaxLen?: number;
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

/**
 * Redis Streams transport for durable request-response messages and event fan-out.
 *
 * The adapter uses consumer groups and a per-consumer response stream so callers can combine
 * at-least-once delivery with request timeouts while preserving Fluo's transport abstraction.
 */
export class RedisStreamsMicroserviceTransport implements MicroserviceTransport {
  private closing = false;
  private readonly consumerId: string;
  private handler: TransportHandler | undefined;
  private logger: MicroserviceTransportLogger | undefined;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private messageGroupLeaseRegistered = false;
  private ownsMessageGroup = false;
  private readonly pending = new Map<string, PendingRequest>();
  private pollPromises: Promise<void>[] = [];

  private readonly namespace: string;
  private readonly consumerGroup: string;
  private readonly requestTimeoutMs: number;
  private readonly pollBlockMs: number;
  private readonly messageRetentionMaxLen: number | undefined;
  private readonly eventRetentionMaxLen: number | undefined;
  private readonly responseRetentionMaxLen: number;

  /**
   * Creates a Redis Streams transport with dedicated reader and writer clients.
   *
   * @param options Namespace, consumer-group, polling, and timeout settings.
   */
  constructor(private readonly options: RedisStreamsMicroserviceTransportOptions) {
    this.consumerId = crypto.randomUUID();
    this.namespace = options.namespace ?? 'fluo:streams';
    this.consumerGroup = options.consumerGroup ?? 'fluo-handlers';
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.pollBlockMs = options.pollBlockMs ?? 500;
    this.messageRetentionMaxLen = options.messageRetentionMaxLen;
    this.eventRetentionMaxLen = options.eventRetentionMaxLen;
    this.responseRetentionMaxLen = options.responseRetentionMaxLen ?? 1_000;
  }

  setLogger(logger: MicroserviceTransportLogger): void {
    this.logger = logger;
  }

  /**
   * Creates consumer groups and starts polling the request, event, and response streams.
   *
   * @param handler Runtime callback invoked for inbound event and message packets.
   * @returns A promise that resolves once all stream consumers are initialized.
   */
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
      this.ownsMessageGroup = await this.ensureConsumerGroup(this.messageStream, this.messageGroup);
      await this.registerMessageGroupLease(this.ownsMessageGroup);
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

  /**
   * Sends one request-response message through Redis Streams.
   *
   * @param pattern Pattern identifying the remote message handler.
   * @param payload Serializable request payload.
   * @param signal Optional abort signal used to cancel the request.
   * @returns The remote handler response payload.
   */
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

        await this.publishFrame(this.messageStream, {
          kind: frame.kind,
          pattern: frame.pattern,
          payload: JSON.stringify(frame.payload),
          replyStream: frame.replyStream,
          requestId: frame.requestId,
        }, this.messageRetentionMaxLen);
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to publish Redis Streams request.'));
      });
    });
  }

  /**
   * Emits one fire-and-forget event through Redis Streams.
   *
   * @param pattern Pattern identifying the remote event handlers.
   * @param payload Serializable event payload.
   * @returns A promise that resolves once the event frame is appended to the stream.
   */
  async emit(pattern: string, payload: unknown): Promise<void> {
    const frame = {
      kind: 'event',
      pattern,
      payload,
    } satisfies RedisStreamTransportMessage;

    await this.publishFrame(this.eventStream, {
      kind: frame.kind,
      pattern: frame.pattern,
      payload: JSON.stringify(frame.payload),
    }, this.eventRetentionMaxLen);
  }

  /**
   * Stops polling and tears down the owned request, event, and response consumer resources.
   *
   * @returns A promise that resolves once shutdown cleanup finishes.
   */
  async close(): Promise<void> {
    this.closing = true;
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      const settled = await Promise.allSettled(this.pollPromises);
      const shouldDestroyMessageGroup = await this.releaseMessageGroupLease();

      for (const result of settled) {
        if (result.status === 'rejected') {
          closeError ??= result.reason;
        }
      }

      if (shouldDestroyMessageGroup) {
        try {
          await this.options.readerClient.xgroupDestroy(this.messageStream, this.messageGroup);
        } catch (error) {
          closeError ??= error;
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

      try {
        await this.options.readerClient.del?.(this.responseStream);
      } catch (error) {
        closeError ??= error;
      }
    } finally {
      this.listening = false;
      this.handler = undefined;
      this.messageGroupLeaseRegistered = false;
      this.ownsMessageGroup = false;
      this.pollPromises = [];

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('Redis Streams microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async ensureConsumerGroup(stream: string, group: string): Promise<boolean> {
    try {
      await this.options.readerClient.xgroupCreate(stream, group, '$', true);
      return true;
    } catch (error) {
      if (this.isBusyGroupError(error)) {
        return false;
      }

      throw error;
    }
  }

  private async registerMessageGroupLease(createdGroup: boolean): Promise<void> {
    const { readerClient } = this.options;

    if (!readerClient.incr || !readerClient.decr || !readerClient.get || !readerClient.set || !readerClient.del) {
      // Without the optional KV helpers we cannot coordinate shared-group ownership safely
      // across listeners, so the fallback path keeps the request consumer group alive.
      this.messageGroupLeaseRegistered = false;
      return;
    }

    if (createdGroup) {
      await readerClient.set(this.messageGroupOwnerKey, this.consumerId);
    }

    await readerClient.incr(this.messageGroupRefCountKey);
    this.messageGroupLeaseRegistered = true;
  }

  private async releaseMessageGroupLease(): Promise<boolean> {
    const { readerClient } = this.options;

    if (!this.messageGroupLeaseRegistered || !readerClient.decr || !readerClient.get) {
      // Fallback/no-lease clients intentionally retain the shared request group because
      // destroying it here could break another active listener that joined via BUSYGROUP.
      return false;
    }

    const remainingListeners = await readerClient.decr(this.messageGroupRefCountKey);

    if (remainingListeners > 0) {
      return false;
    }

    await readerClient.del?.(this.messageGroupRefCountKey);

    const owner = await readerClient.get(this.messageGroupOwnerKey);

    if (!owner) {
      return false;
    }

    await readerClient.del?.(this.messageGroupOwnerKey);
    return true;
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

          if (!parsed) {
            await this.options.readerClient.xack(stream, group, entry.id);
            continue;
          }

          const shouldAcknowledge = await this.handleStreamEntry(stream, parsed);

          if (shouldAcknowledge) {
            await this.options.readerClient.xack(stream, group, entry.id);
            await this.cleanupAcknowledgedEntry(stream, entry.id);
          }
        }
      } catch {
        if (!this.closing) {
          await delay(this.pollBlockMs);
        }
      }
    }
  }

  private async handleStreamEntry(stream: string, message: RedisStreamTransportMessage): Promise<boolean> {
    if (stream === this.messageStream) {
      await this.handleInboundRequest(message);
      return true;
    }

    if (stream === this.eventStream) {
      return await this.handleInboundEvent(message);
    }

    this.handleInboundResponse(message);
    return true;
  }

  private async handleInboundRequest(message: RedisStreamTransportMessage): Promise<void> {
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

      await this.publishFrame(replyStream, {
        kind: 'response',
        pattern: message.pattern,
        payload: JSON.stringify(payload),
        requestId,
      }, this.responseRetentionMaxLen);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';

      await this.publishFrame(replyStream, {
        error: errorMessage,
        kind: 'response',
        pattern: message.pattern,
        requestId,
      }, this.responseRetentionMaxLen);
    }
  }

  private async publishFrame(
    stream: string,
    fields: Record<string, string>,
    maxLenApproximate?: number,
  ): Promise<void> {
    if (typeof maxLenApproximate === 'number' && maxLenApproximate > 0) {
      await this.options.writerClient.xadd(stream, fields, {
        maxLenApproximate,
      });
      return;
    }

    await this.options.writerClient.xadd(stream, fields);
  }

  private async cleanupAcknowledgedEntry(stream: string, id: string): Promise<void> {
    if (stream !== this.messageStream && stream !== this.responseStream) {
      return;
    }

    await this.options.readerClient.xdel?.(stream, id);
  }

  private async handleInboundEvent(message: RedisStreamTransportMessage): Promise<boolean> {
    if (!this.handler) {
      return true;
    }

    if (message.kind !== 'event') {
      return true;
    }

    try {
      await this.handler({
        kind: 'event',
        pattern: message.pattern,
        payload: message.payload,
      });

      return true;
    } catch (error) {
      this.logEventHandlerFailure(error);
      return false;
    }
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
    if (this.logger) {
      this.logger.error('Event handler failed.', error, 'RedisStreamsMicroserviceTransport');
      return;
    }

    console.error('[fluo][RedisStreamsMicroserviceTransport] event handler failed:', error);
  }

  private isBusyGroupError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('BUSYGROUP');
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

  private get messageGroupOwnerKey(): string {
    return `${this.namespace}:groups:${this.consumerGroup}:owner`;
  }

  private get messageGroupRefCountKey(): string {
    return `${this.namespace}:groups:${this.consumerGroup}:listeners`;
  }

  private get eventGroup(): string {
    return `${this.consumerGroup}:events:${this.consumerId}`;
  }

  private get responseGroup(): string {
    return `${this.consumerGroup}:responses:${this.consumerId}`;
  }
}
