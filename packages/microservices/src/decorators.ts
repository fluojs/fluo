import { metadataSymbol } from '@fluojs/core/internal';

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

  if (kind === 'client-stream') {
    return 'ClientStreamPattern';
  }

  if (kind === 'bidi-stream') {
    return 'BidiStreamPattern';
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

/**
 * Marks a public instance method as the request-response handler for one message pattern.
 *
 * @param pattern String or `RegExp` pattern matched against inbound transport packets.
 * @returns A method decorator that stores message-handler metadata for runtime discovery.
 *
 * @example
 * ```ts
 * import { MessagePattern } from '@fluojs/microservices';
 *
 * export class MathHandler {
 *   @MessagePattern('math.sum')
 *   sum(data: { a: number; b: number }) {
 *     return data.a + data.b;
 *   }
 * }
 * ```
 */
export function MessagePattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('message', pattern);
}

/**
 * Marks a public instance method as the fire-and-forget handler for one event pattern.
 *
 * @param pattern String or `RegExp` pattern matched against inbound event packets.
 * @returns A method decorator that stores event-handler metadata for runtime discovery.
 */
export function EventPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('event', pattern);
}

/**
 * Marks a public instance method as the server-streaming handler for one pattern.
 *
 * @param pattern String or `RegExp` pattern matched against inbound server-stream packets.
 * @returns A method decorator that stores server-stream metadata for runtime discovery.
 */
export function ServerStreamPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('server-stream', pattern);
}

/**
 * Marks a public instance method as the client-streaming handler for one pattern.
 *
 * @param pattern String or `RegExp` pattern matched against inbound client-stream packets.
 * @returns A method decorator that stores client-stream metadata for runtime discovery.
 */
export function ClientStreamPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('client-stream', pattern);
}

/**
 * Marks a public instance method as the bidirectional streaming handler for one pattern.
 *
 * @param pattern String or `RegExp` pattern matched against inbound bidirectional stream packets.
 * @returns A method decorator that stores bidi-stream metadata for runtime discovery.
 */
export function BidiStreamPattern(pattern: Pattern): MethodDecoratorLike {
  return createPatternDecorator('bidi-stream', pattern);
}
