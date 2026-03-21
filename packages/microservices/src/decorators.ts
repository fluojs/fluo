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

function createPatternDecorator(kind: HandlerKind, pattern: Pattern): MethodDecoratorLike {
  return (_value: Function, context: ClassMethodDecoratorContext): void => {
    if (context.private) {
      throw new Error(`@${kind === 'message' ? 'MessagePattern' : 'EventPattern'}() cannot be used on private methods.`);
    }

    if (context.static) {
      throw new Error(`@${kind === 'message' ? 'MessagePattern' : 'EventPattern'}() cannot be used on static methods.`);
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
