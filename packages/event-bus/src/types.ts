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

/** Per-call bounds for matching local handlers and optional transport publication. */
export interface EventPublishOptions {
  /**
   * Cancellation bound for local dispatch and transport publication.
   * An already-aborted signal skips work that has not started. Aborting while awaited work is
   * running settles the caller-facing wait without terminating the underlying shutdown-tracked work.
   */
  signal?: AbortSignal;
  /**
   * Positive finite timeout applied while awaiting each local handler and transport publication.
   * Non-positive or non-finite values disable the timeout. Ignored when `waitForHandlers` is `false`.
   */
  timeoutMs?: number;
  /**
   * Whether `publish()` waits for local handlers and transport publication within the configured bounds.
   * Defaults to `true`. When `false`, both kinds of work continue in the background and remain part of
   * shutdown drain tracking.
   */
  waitForHandlers?: boolean;
}

/** Transport adapter contract for cross-process event fan-out and inbound subscription wiring. */
export interface EventBusTransport {
  /**
   * Publish an event payload to the external transport under the given channel name.
   * Called for each selected transport channel when a transport is configured; one local
   * `publish()` invocation can fan out to multiple inherited event channels.
   */
  publish(channel: string, payload: unknown): Promise<void>;

  /**
   * Subscribe to incoming messages on the given channel from the external transport.
   * The event bus calls this once per unique event channel during bootstrap.
   * Received messages are dispatched to every matching local handler for that channel.
   */
  subscribe(channel: string, handler: (payload: unknown) => Promise<void>): Promise<void>;

  /**
   * Release transport-owned subscriptions, listeners, and resources during application shutdown.
   * Adapter-specific ownership rules determine whether injected clients or connections remain open.
   */
  close(): Promise<void>;
}

/** Module options for local event dispatch defaults and optional external fan-out. */
export interface EventBusModuleOptions {
  /** Whether event-bus providers should be visible globally. Defaults to `true`. */
  global?: boolean;
  publish?: {
    timeoutMs?: number;
    waitForHandlers?: boolean;
  };
  /** Shutdown drain policy. `drainTimeoutMs` defaults to 5000ms. */
  shutdown?: {
    drainTimeoutMs?: number;
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
   * @param options Optional bounds for matching local handlers and transport publication.
   * @returns A promise that resolves after the configured workflow completes, or after background work is scheduled
   * when `waitForHandlers` is `false`.
   */
  publish(event: object, options?: EventPublishOptions): Promise<void>;
}
