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

export interface EventBusModuleOptions {
  publish?: {
    timeoutMs?: number;
    waitForHandlers?: boolean;
  };
}

export interface EventBus {
  publish(event: object, options?: EventPublishOptions): Promise<void>;
}
