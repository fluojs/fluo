import { metadataSymbol } from '@konekti/core';

import {
  commandHandlerMetadataSymbol,
  eventHandlerMetadataSymbol,
  queryHandlerMetadataSymbol,
  sagaMetadataSymbol,
} from './metadata.js';
import type {
  CommandHandlerMetadata,
  CommandType,
  CqrsEventType,
  EventHandlerMetadata,
  QueryHandlerMetadata,
  QueryType,
  SagaMetadata,
} from './types.js';

type ClassDecoratorLike = (value: Function, context: ClassDecoratorContext) => void;
type StandardMetadataBag = Record<PropertyKey, unknown>;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;

  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('Decorator metadata is unavailable. Ensure standard decorators are enabled.');
  }

  return metadata as StandardMetadataBag;
}

function defineStandardCommandHandlerMetadata(metadata: unknown, handlerMetadata: CommandHandlerMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[commandHandlerMetadataSymbol] = {
    commandType: handlerMetadata.commandType,
  } satisfies CommandHandlerMetadata;
}

function defineStandardQueryHandlerMetadata(metadata: unknown, handlerMetadata: QueryHandlerMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[queryHandlerMetadataSymbol] = {
    queryType: handlerMetadata.queryType,
  } satisfies QueryHandlerMetadata;
}

function defineStandardEventHandlerMetadata(metadata: unknown, handlerMetadata: EventHandlerMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[eventHandlerMetadataSymbol] = {
    eventType: handlerMetadata.eventType,
  } satisfies EventHandlerMetadata;
}

function defineStandardSagaMetadata(metadata: unknown, sagaMetadata: SagaMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[sagaMetadataSymbol] = {
    eventTypes: [...sagaMetadata.eventTypes],
  } satisfies SagaMetadata;
}

function normalizeSagaEventTypes(eventTypeOrTypes: CqrsEventType | readonly CqrsEventType[]): readonly CqrsEventType[] {
  const eventTypes = Array.isArray(eventTypeOrTypes) ? eventTypeOrTypes : [eventTypeOrTypes];
  const uniqueEventTypes = Array.from(new Set(eventTypes));

  if (uniqueEventTypes.length === 0) {
    throw new Error('@Saga() requires at least one event type.');
  }

  for (const eventType of uniqueEventTypes) {
    if (typeof eventType !== 'function') {
      throw new Error('@Saga() event types must be class constructors.');
    }
  }

  return uniqueEventTypes;
}

export function CommandHandler(commandType: CommandType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: CommandHandlerMetadata = {
      commandType,
    };

    defineStandardCommandHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

export function QueryHandler(queryType: QueryType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: QueryHandlerMetadata = {
      queryType,
    };

    defineStandardQueryHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

export function EventHandler(eventType: CqrsEventType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: EventHandlerMetadata = {
      eventType,
    };

    defineStandardEventHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

export function Saga(eventTypeOrTypes: CqrsEventType | readonly CqrsEventType[]): ClassDecoratorLike {
  const eventTypes = normalizeSagaEventTypes(eventTypeOrTypes);

  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: SagaMetadata = {
      eventTypes,
    };

    defineStandardSagaMetadata(context.metadata, metadata);
  };

  return decorator;
}
