import type { MicroserviceTransport, TransportHandler } from './types.js';

type DynamicImport = (specifier: string) => Promise<unknown>;

interface MqttPublishOptions {
  qos?: number;
  retain?: boolean;
}

interface MqttSubscribeOptions {
  qos?: number;
}

interface MqttConnectOptions {
  [key: string]: unknown;
}

interface MqttPacketLike {
  retain?: boolean;
  qos?: number;
}

interface MqttClientLike {
  end(force?: boolean, callback?: (error?: Error) => void): void;
  off?(event: 'message', listener: (topic: string, payload: Buffer, packet: MqttPacketLike) => void): void;
  on(event: 'message', listener: (topic: string, payload: Buffer, packet: MqttPacketLike) => void): void;
  publish(
    topic: string,
    payload: string,
    options: MqttPublishOptions,
    callback?: (error?: Error) => void,
  ): void;
  subscribe(
    topic: string,
    options: MqttSubscribeOptions,
    callback?: (error?: Error) => void,
  ): void;
  unsubscribe(topic: string, callback?: (error?: Error) => void): void;
}

interface MqttModuleLike {
  connect(url: string, options?: MqttConnectOptions): MqttClientLike;
}

interface MqttEnvelope {
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

const mqttKinds = {
  event: 'event',
  message: 'message',
  response: 'response',
} as const;

export interface MqttMicroserviceTransportOptions {
  client?: MqttClientLike;
  url?: string;
  connectOptions?: MqttConnectOptions;
  namespace?: string;
  eventTopic?: string;
  messageTopic?: string;
  replyTopic?: string;
  requestTimeoutMs?: number;
  eventQos?: 0 | 1 | 2;
  messageQos?: 0 | 1 | 2;
  responseQos?: 0 | 1 | 2;
  eventRetain?: boolean;
  messageRetain?: boolean;
  responseRetain?: boolean;
  mqtt?: MqttModuleLike;
  moduleLoader?: DynamicImport;
}

export class MqttMicroserviceTransport implements MicroserviceTransport {
  private client: MqttClientLike | undefined;
  private closing = false;
  private handler: TransportHandler | undefined;
  private readonly internallyOwnedClient: boolean;
  private listening = false;
  private listenPromise: Promise<void> | undefined;
  private readonly messageListener = (topic: string, payload: Buffer) => {
    void this.handleInbound(topic, payload.toString('utf8')).catch(() => undefined);
  };

  private readonly eventQos: number;
  private readonly eventRetain: boolean;
  private readonly eventTopic: string;
  private readonly messageQos: number;
  private readonly messageRetain: boolean;
  private readonly messageTopic: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly replyTopic: string;
  private readonly requestTimeoutMs: number;
  private readonly responseQos: number;
  private readonly responseRetain: boolean;

  constructor(private readonly options: MqttMicroserviceTransportOptions) {
    const namespace = options.namespace ?? 'konekti.microservices';

    this.eventTopic = options.eventTopic ?? `${namespace}.events`;
    this.messageTopic = options.messageTopic ?? `${namespace}.messages`;
    this.replyTopic = options.replyTopic ?? `${namespace}.responses.${crypto.randomUUID()}`;
    this.eventQos = options.eventQos ?? 0;
    this.messageQos = options.messageQos ?? 1;
    this.responseQos = options.responseQos ?? 1;
    this.eventRetain = options.eventRetain ?? false;
    this.messageRetain = options.messageRetain ?? false;
    this.responseRetain = options.responseRetain ?? false;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.client = options.client;
    this.internallyOwnedClient = !options.client;
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
      const client = await this.resolveClient();
      const subscribed: string[] = [];

      client.on('message', this.messageListener);

      try {
        await this.subscribeTopic(client, this.eventTopic, this.eventQos);
        subscribed.push(this.eventTopic);

        await this.subscribeTopic(client, this.messageTopic, this.messageQos);
        subscribed.push(this.messageTopic);

        await this.subscribeTopic(client, this.replyTopic, this.responseQos);
        subscribed.push(this.replyTopic);
      } catch (error) {
        for (const topic of subscribed) {
          await this.unsubscribeTopic(client, topic).catch(() => undefined);
        }

        client.off?.('message', this.messageListener);

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
      throw new Error('MqttMicroserviceTransport is closing. Wait for close() to complete before send().');
    }

    if (!this.listening) {
      throw new Error('MqttMicroserviceTransport is not listening. Call listen() before send().');
    }

    const requestId = crypto.randomUUID();
    const frame = {
      kind: mqttKinds.message,
      pattern,
      payload,
      requestId,
      replyTopic: this.replyTopic,
    } satisfies MqttEnvelope;

    return await new Promise<unknown>((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

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
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve(value);
        },
        reject: (error: unknown) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          reject(error);
        },
      };

      this.pending.set(requestId, entry);

      timeout = setTimeout(() => {
        entry.reject(new Error(`MQTT request timed out after ${String(this.requestTimeoutMs)}ms waiting for pattern "${pattern}".`));
      }, this.requestTimeoutMs);

      if (signal) {
        if (signal.aborted) {
          entry.reject(new Error('MQTT request aborted before publish.'));
          return;
        }

        abortHandler = () => {
          entry.reject(new Error('MQTT request aborted.'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      void Promise.resolve().then(async () => {
        if (this.closing) {
          entry.reject(new Error('MQTT microservice transport closed before response.'));
          return;
        }

        const client = await this.resolveClient();
        await this.publish(client, this.messageTopic, frame, {
          qos: this.messageQos,
          retain: this.messageRetain,
        });
      }).catch((error: unknown) => {
        entry.reject(error instanceof Error ? error : new Error('Failed to publish MQTT request.'));
      });
    });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (this.closing) {
      throw new Error('MqttMicroserviceTransport is closing. Wait for close() to complete before emit().');
    }

    const client = await this.resolveClient();
    const frame = {
      kind: mqttKinds.event,
      pattern,
      payload,
    } satisfies MqttEnvelope;

    await this.publish(client, this.eventTopic, frame, {
      qos: this.eventQos,
      retain: this.eventRetain,
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    let closeError: unknown;

    if (this.listenPromise) {
      await this.listenPromise;
    }

    try {
      const client = this.client;

      if (client && this.listening) {
        for (const topic of [this.eventTopic, this.messageTopic, this.replyTopic]) {
          try {
            await this.unsubscribeTopic(client, topic);
          } catch (error) {
            closeError ??= error;
          }
        }
      }

      if (client) {
        client.off?.('message', this.messageListener);

        if (this.internallyOwnedClient) {
          try {
            await this.endClient(client);
          } catch (error) {
            closeError ??= error;
          }
        }
      }
    } finally {
      this.handler = undefined;
      this.listening = false;

      if (this.internallyOwnedClient) {
        this.client = undefined;
      }

      for (const pending of [...this.pending.values()]) {
        pending.reject(new Error('MQTT microservice transport closed before response.'));
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  private async handleInbound(topic: string, rawMessage: string): Promise<void> {
    const frame = parseEnvelope(rawMessage);

    if (!frame) {
      return;
    }

    if (topic === this.replyTopic) {
      this.handleInboundResponse(frame);
      return;
    }

    if (!this.handler) {
      return;
    }

    if (topic === this.eventTopic && frame.kind === mqttKinds.event) {
      await this.handleInboundEvent(frame);
      return;
    }

    if (topic === this.messageTopic && frame.kind === mqttKinds.message && frame.requestId) {
      await this.handleInboundRequest(frame);
    }
  }

  private async handleInboundEvent(frame: MqttEnvelope): Promise<void> {
    if (!this.handler) {
      return;
    }

    try {
      await this.handler({
        kind: 'event',
        pattern: frame.pattern,
        payload: frame.payload,
      });
    } catch (error) {
      this.logEventHandlerFailure(error);
    }
  }

  private async handleInboundRequest(frame: MqttEnvelope): Promise<void> {
    if (!this.handler || !frame.requestId) {
      return;
    }

    const client = this.client;

    if (!client) {
      return;
    }

    const replyTopic = frame.replyTopic && frame.replyTopic.length > 0
      ? frame.replyTopic
      : this.replyTopic;

    try {
      const payload = await this.handler({
        kind: 'message',
        pattern: frame.pattern,
        payload: frame.payload,
        requestId: frame.requestId,
      });

      await this.publish(client, replyTopic, {
        kind: mqttKinds.response,
        pattern: frame.pattern,
        payload,
        requestId: frame.requestId,
      }, {
        qos: this.responseQos,
        retain: this.responseRetain,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled microservice error';

      await this.publish(client, replyTopic, {
        error: errorMessage,
        kind: mqttKinds.response,
        pattern: frame.pattern,
        requestId: frame.requestId,
      }, {
        qos: this.responseQos,
        retain: this.responseRetain,
      });
    }
  }

  private handleInboundResponse(frame: MqttEnvelope): void {
    if (frame.kind !== mqttKinds.response || !frame.requestId) {
      return;
    }

    const pending = this.pending.get(frame.requestId);

    if (!pending) {
      return;
    }

    if (frame.error) {
      pending.reject(new Error(frame.error));
      return;
    }

    pending.resolve(frame.payload);
  }

  private async resolveClient(): Promise<MqttClientLike> {
    if (this.client) {
      return this.client;
    }

    const mqtt = await this.resolveMqttModule();
    const url = this.options.url;

    if (!url || url.length === 0) {
      throw new Error('MqttMicroserviceTransport requires options.url when options.client is not provided.');
    }

    this.client = mqtt.connect(url, this.options.connectOptions);

    return this.client;
  }

  private async resolveMqttModule(): Promise<MqttModuleLike> {
    if (this.options.mqtt) {
      return this.options.mqtt;
    }

    const moduleLoader = this.options.moduleLoader ?? defaultDynamicImport;

    try {
      const loaded = await moduleLoader('mqtt') as { default?: unknown };
      const mqtt = (loaded.default ?? loaded) as MqttModuleLike;

      if (!mqtt || typeof mqtt !== 'object' || typeof mqtt.connect !== 'function') {
        throw new Error('Failed to load mqtt runtime module.');
      }

      return mqtt;
    } catch (error) {
      throw createMissingPeerDependencyError('mqtt', error);
    }
  }

  private async publish(
    client: MqttClientLike,
    topic: string,
    message: MqttEnvelope,
    options: MqttPublishOptions,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, JSON.stringify(message), options, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async subscribeTopic(client: MqttClientLike, topic: string, qos: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      client.subscribe(topic, { qos }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async unsubscribeTopic(client: MqttClientLike, topic: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      client.unsubscribe(topic, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async endClient(client: MqttClientLike): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      client.end(false, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private logEventHandlerFailure(error: unknown): void {
    console.error('[konekti][MqttMicroserviceTransport] event handler failed:', error);
  }
}

function parseEnvelope(rawMessage: string): MqttEnvelope | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  const candidate = parsed as Partial<MqttEnvelope>;

  if (candidate.kind !== mqttKinds.event && candidate.kind !== mqttKinds.message && candidate.kind !== mqttKinds.response) {
    return undefined;
  }

  if (typeof candidate.pattern !== 'string') {
    return undefined;
  }

  if (candidate.error !== undefined && typeof candidate.error !== 'string') {
    return undefined;
  }

  if (candidate.requestId !== undefined && typeof candidate.requestId !== 'string') {
    return undefined;
  }

  if (candidate.replyTopic !== undefined && typeof candidate.replyTopic !== 'string') {
    return undefined;
  }

  return candidate as MqttEnvelope;
}

function createMissingPeerDependencyError(specifier: string, originalError: unknown): Error {
  const details = originalError instanceof Error && typeof originalError.message === 'string'
    ? ` (${originalError.message})`
    : '';

  return new Error(
    `Missing optional peer dependency "${specifier}" required by MqttMicroserviceTransport. Install it with "pnpm add ${specifier}" in your application.${details}`,
  );
}

const defaultDynamicImport: DynamicImport = async (specifier) => {
  return await import(specifier);
};
