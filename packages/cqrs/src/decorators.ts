import { metadataSymbol } from '@fluojs/core/internal';

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

/**
 * Associates a singleton provider class with one command type.
 *
 * @param commandType Command constructor handled by the decorated class.
 * @returns A class decorator that stores command-handler metadata for discovery.
 *
 * @example
 * ```ts
 * import { CommandHandler, type ICommandHandler } from '@fluojs/cqrs';
 *
 * class CreateUserCommand {
 *   constructor(public readonly name: string) {}
 * }
 *
 * @CommandHandler(CreateUserCommand)
 * export class CreateUserHandler implements ICommandHandler<CreateUserCommand, string> {
 *   async execute(command: CreateUserCommand) {
 *     return command.name;
 *   }
 * }
 * ```
 */
export function CommandHandler(commandType: CommandType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: CommandHandlerMetadata = {
      commandType,
    };

    defineStandardCommandHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

/**
 * Associates a singleton provider class with one query type.
 *
 * @param queryType Query constructor handled by the decorated class.
 * @returns A class decorator that stores query-handler metadata for discovery.
 */
export function QueryHandler(queryType: QueryType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: QueryHandlerMetadata = {
      queryType,
    };

    defineStandardQueryHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

/**
 * Associates a singleton provider class with one event type.
 *
 * @param eventType Event constructor handled by the decorated class.
 * @returns A class decorator that stores event-handler metadata for discovery.
 */
export function EventHandler(eventType: CqrsEventType): ClassDecoratorLike {
  const decorator = (_value: Function, context: ClassDecoratorContext): void => {
    const metadata: EventHandlerMetadata = {
      eventType,
    };

    defineStandardEventHandlerMetadata(context.metadata, metadata);
  };

  return decorator;
}

/**
 * Marks a singleton provider class as a saga listener for one or more event types.
 *
 * @param eventTypeOrTypes One event constructor or a list of constructors that should trigger the saga.
 * @returns A class decorator that stores saga metadata for discovery.
 */
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
