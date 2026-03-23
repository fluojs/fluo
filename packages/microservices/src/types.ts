import type { MetadataPropertyKey, Token } from '@konekti/core';
import type { Scope } from '@konekti/di';

export type Pattern = RegExp | string;
export type HandlerKind = 'event' | 'message';

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

export interface TransportHandler {
  (packet: TransportPacket): Promise<unknown>;
}

export interface MicroserviceTransport {
  close(): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(handler: TransportHandler): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface MicroserviceModuleOptions {
  transport: MicroserviceTransport;
}

export interface Microservice {
  close(signal?: string): Promise<void>;
  emit(pattern: string, payload: unknown): Promise<void>;
  listen(): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}
