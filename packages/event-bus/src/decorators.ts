import { metadataSymbol } from '@konekti/core/internal';

import type { EventHandlerMetadata, EventType } from './types.js';
import { eventBusMetadataSymbol } from './metadata.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type MethodDecoratorLike = StandardMethodDecoratorFn;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function defineStandardEventHandlerMetadata(
  metadata: unknown,
  propertyKey: string | symbol,
  eventHandlerMetadata: EventHandlerMetadata,
): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[eventBusMetadataSymbol] as Map<string | symbol, EventHandlerMetadata> | undefined;
  const map = current ?? new Map<string | symbol, EventHandlerMetadata>();
  map.set(propertyKey, {
    eventType: eventHandlerMetadata.eventType,
  });
  bag[eventBusMetadataSymbol] = map;
}

export function OnEvent(eventType: EventType): MethodDecoratorLike {
  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    if (context.private) {
      throw new Error('@OnEvent() cannot be used on private methods.');
    }

    if (context.static) {
      throw new Error('@OnEvent() cannot be used on static methods.');
    }

    const metadata: EventHandlerMetadata = {
      eventType,
    };

    defineStandardEventHandlerMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}
