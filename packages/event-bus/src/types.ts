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

export interface EventBus {
  publish(event: object): Promise<void>;
}
