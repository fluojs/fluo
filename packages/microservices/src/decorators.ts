import { metadataSymbol } from '@konekti/core';

import { microserviceMetadataSymbol } from './metadata.js';
import type { HandlerKind, HandlerMetadata, Pattern } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type MethodDecoratorLike = (value: Function, context: ClassMethodDecoratorContext) => void;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function defineStandardHandlerMetadata(
  metadata: unknown,
  propertyKey: string | symbol,
  handlerMetadata: HandlerMetadata,
): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[microserviceMetadataSymbol] as Map<string | symbol, HandlerMetadata[]> | undefined;
  const map = current ?? new Map<string | symbol, HandlerMetadata[]>();
  const entries = map.get(propertyKey) ?? [];
  entries.push(handlerMetadata);
  map.set(propertyKey, entries);
  bag[microserviceMetadataSymbol] = map;
}

function decoratorDisplayName(kind: HandlerKind): string {
  if (kind === 'message') {
    return 'MessagePattern';
  }

  if (kind === 'server-stream') {
    return 'ServerStreamPattern';
  }

  return 'EventPattern';
}

function createPatternDecorator(kind: HandlerKind, pattern: Pattern): MethodDecoratorLike {
  return (_value: Function, context: ClassMethodDecoratorContext): void => {
    if (context.private) {
      throw new Error(`@${decoratorDisplayName(kind)}() cannot be used on private methods.`);
    }

    if (context.static) {
      throw new Error(`@${decoratorDisplayName(kind)}() cannot be used on static methods.`);
    }

    defineStandardHandlerMetadata(context.metadata, context.name, {
      kind,
      pattern,
    });
  };
}

export function MessagePattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('message', pattern);
}

export function EventPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('event', pattern);
}

export function ServerStreamPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('server-stream', pattern);
}
