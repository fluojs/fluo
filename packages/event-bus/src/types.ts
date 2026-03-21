import type { MetadataPropertyKey, Token } from '@konekti/core';

export interface EventType<TEvent extends object = object> {
  new (...args: never[]): TEvent;
}

export interface EventHandlerMetadata {
  eventType: EventType;
}

export interface EventHandlerDescriptor {
  eventType: EventType;
  methodKey: MetadataPropertyKey;
  methodName: string;
  moduleName: string;
  targetName: string;
  token: Token;
}

export interface EventPublishOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  waitForHandlers?: boolean;
}

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

export interface EventBus {
  publish(event: object, options?: EventPublishOptions): Promise<void>;
}
