import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { Scope } from '@konekti/di';

export type Pattern = RegExp | string;
export type HandlerKind = 'bidi-stream' | 'client-stream' | 'event' | 'message' | 'server-stream';

export interface HandlerMetadata {
  kind: HandlerKind;
  pattern: Pattern;
}

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

export interface TransportPacket {
  kind: HandlerKind;
  pattern: string;
  payload: unknown;
  requestId?: string;
}

export type TransportHandler = (packet: TransportPacket) => Promise<unknown>

export interface ServerStreamWriter {
  write(data: unknown): void;
  end(): void;
  error(err: Error): void;
}

export type ServerStreamHandler = (
  payload: unknown,
  writer: ServerStreamWriter,
) => void | Promise<void>;

export type TransportServerStreamHandler = (
  pattern: string,
  payload: unknown,
  writer: ServerStreamWriter,
) => void | Promise<void>;

export type ClientStreamHandler = (
  reader: AsyncIterable<unknown>,
) => Promise<unknown>;

export type TransportClientStreamHandler = (
  pattern: string,
  reader: AsyncIterable<unknown>,
) => Promise<unknown>;

export type BidiStreamHandler = (
  reader: AsyncIterable<unknown>,
  writer: ServerStreamWriter,
) => void | Promise<void>;

export type TransportBidiStreamHandler = (
  pattern: string,
  reader: AsyncIterable<unknown>,
  writer: ServerStreamWriter,
) => void | Promise<void>;

export interface MicroserviceTransport {
  bidiStream?(pattern: string, signal?: AbortSignal): { reader: AsyncIterable<unknown>; writer: ServerStreamWriter };
  clientStream?(pattern: string, signal?: AbortSignal): { writer: ServerStreamWriter; result: Promise<unknown> };
  close(): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(handler: TransportHandler): Promise<void>;
  listenBidiStreaming?(handler: TransportBidiStreamHandler): void;
  listenClientStreaming?(handler: TransportClientStreamHandler): void;
  listenServerStreaming?(handler: TransportServerStreamHandler): void;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}

export interface MicroserviceModuleOptions {
  transport: MicroserviceTransport;
}

export interface Microservice {
  bidiStream?(pattern: string, signal?: AbortSignal): { reader: AsyncIterable<unknown>; writer: ServerStreamWriter };
  clientStream?(pattern: string, signal?: AbortSignal): { writer: ServerStreamWriter; result: Promise<unknown> };
  close(signal?: string): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}
