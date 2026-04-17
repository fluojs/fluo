import type { MetadataPropertyKey, Token } from '@fluojs/core';
import type { Provider, Scope } from '@fluojs/di';
import type { ApplicationLogger } from '@fluojs/runtime';

/** Pattern matcher used to route messages and events to handler methods. */
export type Pattern = RegExp | string;
/** Supported microservice handler kinds discovered from decorators. */
export type HandlerKind = 'bidi-stream' | 'client-stream' | 'event' | 'message' | 'server-stream';

/** Metadata stored by one pattern decorator on a handler method. */
export interface HandlerMetadata {
  kind: HandlerKind;
  pattern: Pattern;
}

/** Runtime descriptor for one discovered microservice handler method. */
export interface HandlerDescriptor {
  kind: HandlerKind;
  methodKey: MetadataPropertyKey;
  methodName: string;
  moduleName: string;
  pattern: Pattern;
  scope: Scope;
  targetName: string;
  token: Token;
}

/** Transport payload delivered to the runtime dispatch layer. */
export interface TransportPacket {
  kind: HandlerKind;
  pattern: string;
  payload: unknown;
  requestId?: string;
}

/** Async entrypoint used by transports to hand packets to the runtime. */
export type TransportHandler = (packet: TransportPacket) => Promise<unknown>;

/** Narrow logger seam transports use for non-fatal handler failure reporting. */
export interface MicroserviceTransportLogger extends Pick<ApplicationLogger, 'error'> {}

/** Writer contract used for server-side and bidirectional streaming responses. */
export interface ServerStreamWriter {
  write(data: unknown): void;
  end(): void;
  error(err: Error): void;
}

/** Handler signature for server-streaming routes. */
export type ServerStreamHandler = (
  payload: unknown,
  writer: ServerStreamWriter,
) => void | Promise<void>;

/** Transport callback signature for server-streaming listeners. */
export type TransportServerStreamHandler = (
  pattern: string,
  payload: unknown,
  writer: ServerStreamWriter,
) => void | Promise<void>;

/** Handler signature for client-streaming routes. */
export type ClientStreamHandler = (
  reader: AsyncIterable<unknown>,
) => Promise<unknown>;

/** Transport callback signature for client-streaming listeners. */
export type TransportClientStreamHandler = (
  pattern: string,
  reader: AsyncIterable<unknown>,
) => Promise<unknown>;

/** Handler signature for bidirectional streaming routes. */
export type BidiStreamHandler = (
  reader: AsyncIterable<unknown>,
  writer: ServerStreamWriter,
) => void | Promise<void>;

/** Transport callback signature for bidirectional streaming listeners. */
export type TransportBidiStreamHandler = (
  pattern: string,
  reader: AsyncIterable<unknown>,
  writer: ServerStreamWriter,
) => void | Promise<void>;

/** Transport adapter contract implemented by TCP, Redis, Kafka, gRPC, and other protocols. */
export interface MicroserviceTransport {
  bidiStream?(pattern: string, signal?: AbortSignal): { reader: AsyncIterable<unknown>; writer: ServerStreamWriter };
  clientStream?(pattern: string, signal?: AbortSignal): { writer: ServerStreamWriter; result: Promise<unknown> };
  close(): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(handler: TransportHandler): Promise<void>;
  listenBidiStreaming?(handler: TransportBidiStreamHandler): void;
  listenClientStreaming?(handler: TransportClientStreamHandler): void;
  listenServerStreaming?(handler: TransportServerStreamHandler): void;
  setLogger?(logger: MicroserviceTransportLogger): void;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}

/** Optional module-definition overrides for callers that want module-first custom registration. */
export interface MicroserviceModuleRegistrationOptions {
  /** Extra tokens exported in addition to `MicroserviceLifecycleService` and `MICROSERVICE`. */
  additionalExports?: Token[];
  /** Whether the configured microservice module should register globally. Defaults to `true`. */
  global?: boolean;
  /** Additional providers appended after the built-in microservice runtime wiring. */
  providers?: Provider[];
}

/** Module options accepted by {@link MicroservicesModule.forRoot}. */
export interface MicroserviceModuleOptions {
  /** Optional module-definition overrides that provide a module-first alternative to raw provider-array composition. */
  module?: MicroserviceModuleRegistrationOptions;
  transport: MicroserviceTransport;
}

/** Programmatic microservice facade exposed through DI and compatibility tokens. */
export interface Microservice {
  bidiStream?(pattern: string, signal?: AbortSignal): { reader: AsyncIterable<unknown>; writer: ServerStreamWriter };
  clientStream?(pattern: string, signal?: AbortSignal): { writer: ServerStreamWriter; result: Promise<unknown> };
  close(signal?: string): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}
