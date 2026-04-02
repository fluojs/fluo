import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { Scope } from '@konekti/di';

export type Pattern = RegExp | string;
export type HandlerKind = 'event' | 'message' | 'server-stream';

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

export interface MicroserviceTransport {
  close(): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(handler: TransportHandler): Promise<void>;
  listenServerStreaming?(handler: TransportServerStreamHandler): void;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}

export interface MicroserviceModuleOptions {
  transport: MicroserviceTransport;
}

export interface Microservice {
  close(signal?: string): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  serverStream?(pattern: string, payload: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
}
