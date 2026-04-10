import type { MetadataPropertyKey, Token } from '@fluojs/core';

/** Constructor type used to identify one published event shape and optional stable transport key. */
export interface EventType<TEvent extends object = object> {
  new (...args: never[]): TEvent;
  readonly eventKey?: string;
}

/** Metadata stored by {@link OnEvent}. */
export interface EventHandlerMetadata {
  eventType: EventType;
}

/** Runtime descriptor for one discovered event handler method. */
export interface EventHandlerDescriptor {
  eventType: EventType;
  methodKey: MetadataPropertyKey;
  methodName: string;
  moduleName: string;
  targetName: string;
  token: Token;
}

/** Options that control how one `publish()` call waits for local handlers. */
export interface EventPublishOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  waitForHandlers?: boolean;
}

/** Transport adapter contract for cross-process event fan-out and inbound subscription wiring. */
export interface EventBusTransport {
  /**
   * Publish an event payload to the external transport under the given channel name.
   * Called by the event bus on every local `publish()` invocation when a transport is configured.
   */
  publish(channel: string, payload: unknown): Promise<void>;

  /**
   * Subscribe to incoming messages on the given channel from the external transport.
   * The event bus calls this once per discovered local handler during bootstrap.
   * Received messages are deserialized and dispatched to matching local handlers.
   */
  subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void>;

  /**
   * Tear down any open connections. Called during application shutdown.
   */
  close(): Promise<void>;
}

/** Module options for local event dispatch defaults and optional external fan-out. */
export interface EventBusModuleOptions {
  publish?: {
    timeoutMs?: number;
    waitForHandlers?: boolean;
  };
  /**
   * Optional external transport adapter (e.g. Redis Pub/Sub).
   * When provided, `publish()` fans out to the transport in addition to local handlers,
   * and incoming transport messages are dispatched to local handlers on bootstrap.
   */
  transport?: EventBusTransport;
}

/** Event publishing facade exposed by the event-bus module. */
export interface EventBus {
  /**
   * Publishes one event to matching local handlers and the optional external transport.
   *
   * @param event Event instance to publish.
   * @param options Optional timeout, abort signal, and wait-for-handler controls.
   * @returns A promise that resolves once the configured publish workflow completes.
   */
  publish(event: object, options?: EventPublishOptions): Promise<void>;
}
