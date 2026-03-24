import { metadataSymbol } from '@konekti/core';

import {
  commandHandlerMetadataSymbol,
  eventHandlerMetadataSymbol,
  queryHandlerMetadataSymbol,
} from './metadata.js';
import type {
  CommandHandlerMetadata,
  CommandType,
  CqrsEventType,
  EventHandlerMetadata,
  QueryHandlerMetadata,
  QueryType,
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
