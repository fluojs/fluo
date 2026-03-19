import { metadataSymbol } from '@konekti/core';

import {
  argMetadataSymbol,
  mutationMetadataSymbol,
  queryMetadataSymbol,
  resolverMetadataSymbol,
  subscriptionMetadataSymbol,
} from './metadata.js';
import type { ArgFieldMetadata, ResolverHandlerMetadata, ResolverMetadata } from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;

export interface ResolverMethodOptions {
  fieldName?: string;
  input?: Function;
  topics?: string | string[];
}

type ClassDecoratorLike = StandardClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn;
type FieldDecoratorLike = StandardFieldDecoratorFn;

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
  void metadataSymbol;
  return metadata as StandardMetadataBag;
}

function normalizeResolverTypeName(typeName: string | undefined, fallbackName: string): string {
  const trimmed = typeName?.trim();

  if (trimmed) {
    return trimmed;
  }

  return fallbackName;
}

function normalizeMethodMetadata(
  type: ResolverHandlerMetadata['type'],
  fieldNameOrOptions: string | ResolverMethodOptions | undefined,
): ResolverHandlerMetadata {
  if (typeof fieldNameOrOptions === 'string') {
    return {
      fieldName: fieldNameOrOptions.trim() || undefined,
      type,
    };
  }

  if (!fieldNameOrOptions) {
    return { type };
  }

  return {
    fieldName: fieldNameOrOptions.fieldName?.trim() || undefined,
    inputClass: fieldNameOrOptions.input,
    topics: fieldNameOrOptions.topics,
    type,
  };
}

function defineStandardResolverMetadata(metadata: unknown, resolverMetadata: ResolverMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  bag[resolverMetadataSymbol] = {
    typeName: resolverMetadata.typeName,
  };
}

function defineStandardHandlerMetadata(metadata: unknown, propertyKey: string | symbol, handlerMetadata: ResolverHandlerMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  const key =
    handlerMetadata.type === 'query'
      ? queryMetadataSymbol
      : handlerMetadata.type === 'mutation'
        ? mutationMetadataSymbol
        : subscriptionMetadataSymbol;
  const current = bag[key] as Map<string | symbol, ResolverHandlerMetadata> | undefined;
  const map = current ?? new Map<string | symbol, ResolverHandlerMetadata>();

  map.set(propertyKey, {
    fieldName: handlerMetadata.fieldName,
    inputClass: handlerMetadata.inputClass,
    topics: handlerMetadata.topics,
    type: handlerMetadata.type,
  });
  bag[key] = map;
}

function defineStandardArgFieldMetadata(metadata: unknown, propertyKey: string | symbol, argFieldMetadata: ArgFieldMetadata): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[argMetadataSymbol] as Map<string | symbol, ArgFieldMetadata> | undefined;
  const map = current ?? new Map<string | symbol, ArgFieldMetadata>();

  map.set(propertyKey, {
    argName: argFieldMetadata.argName,
    fieldName: argFieldMetadata.fieldName,
  });
  bag[argMetadataSymbol] = map;
}

function createMethodDecorator(
  type: ResolverHandlerMetadata['type'],
  fieldNameOrOptions?: string | ResolverMethodOptions,
): MethodDecoratorLike {
  const metadata = normalizeMethodMetadata(type, fieldNameOrOptions);

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    const name = type === 'query' ? 'Query' : type === 'mutation' ? 'Mutation' : 'Subscription';

    if (context.private) {
      throw new Error(`@${name}() cannot be used on private methods.`);
    }

    if (context.static) {
      throw new Error(`@${name}() cannot be used on static methods.`);
    }

    defineStandardHandlerMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}

export function Resolver(typeName?: string): ClassDecoratorLike {
  const decorator = (value: Function, context: ClassDecoratorContext) => {
    defineStandardResolverMetadata(context.metadata, {
      typeName: normalizeResolverTypeName(typeName, value.name || 'Resolver'),
    });
  };

  return decorator as ClassDecoratorLike;
}

export function Query(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('query', fieldNameOrOptions);
}

export function Mutation(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('mutation', fieldNameOrOptions);
}

export function Subscription(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('subscription', fieldNameOrOptions);
}

export function Arg(argName?: string): FieldDecoratorLike {
  const decorator = <This, Value>(_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => {
    if (context.private) {
      throw new Error('@Arg() cannot be used on private fields.');
    }

    if (context.static) {
      throw new Error('@Arg() cannot be used on static fields.');
    }

    const fieldName = typeof context.name === 'symbol' ? context.name.toString() : context.name;

    defineStandardArgFieldMetadata(context.metadata, context.name, {
      argName: argName?.trim() || fieldName,
      fieldName,
    });
  };

  return decorator as FieldDecoratorLike;
}
