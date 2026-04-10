import { metadataSymbol } from '@fluojs/core/internal';

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

/**
 * Marks a public instance method as the handler for one event type.
 *
 * @param eventType Event constructor that should trigger the decorated method.
 * @returns A method decorator that stores handler metadata for bootstrap discovery.
 *
 * @example
 * ```ts
 * import { OnEvent } from '@fluojs/event-bus';
 *
 * class UserRegisteredEvent {
 *   constructor(public readonly email: string) {}
 * }
 *
 * export class NotificationService {
 *   @OnEvent(UserRegisteredEvent)
 *   async notify(event: UserRegisteredEvent) {
 *     await mailer.send(event.email);
 *   }
 * }
 * ```
 */
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
