import { ensureMetadataSymbol } from '@fluojs/core/internal';

import {
  argMetadataSymbol,
  fieldResolverParameterMetadataSymbol,
  handlerMetadataSymbol,
  resolverMetadataSymbol,
} from './metadata.js';
import type {
  ArgFieldMetadata,
  FieldResolverParameterBindingMetadata,
  FieldResolverParameterKind,
  GraphqlArgType,
  GraphqlRootOutputType,
  ResolverHandlerMetadata,
  ResolverMetadata,
} from './types.js';

type StandardMetadataBag = Record<PropertyKey, unknown>;
type StandardClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type StandardMethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;
type StandardFieldDecoratorFn = <This, Value>(value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void;

/**
 * Describes the resolver method options contract.
 */
export interface ResolverMethodOptions {
  fieldName?: string;
  input?: Function;
  argTypes?: Record<string, GraphqlArgType>;
  outputType?: GraphqlRootOutputType;
}

/**
 * Describes an object field resolver's field name and optional output type override.
 */
export interface FieldResolverOptions {
  fieldName?: string;
  type?: GraphqlRootOutputType;
  nullable?: boolean;
}

type ClassDecoratorLike = StandardClassDecoratorFn;
type MethodDecoratorLike = StandardMethodDecoratorFn;
type FieldDecoratorLike = StandardFieldDecoratorFn;

ensureMetadataSymbol();

function getStandardMetadataBag(metadata: unknown): StandardMetadataBag {
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

  if ('topics' in fieldNameOrOptions) {
    throw new Error(
      'Resolver method option "topics" is not supported. GraphQL subscriptions must return an AsyncIterable directly until topic routing becomes a documented runtime feature.',
    );
  }

  return {
    argTypes: fieldNameOrOptions.argTypes,
    fieldName: fieldNameOrOptions.fieldName?.trim() || undefined,
    inputClass: fieldNameOrOptions.input,
    outputType: fieldNameOrOptions.outputType,
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
  const current = bag[handlerMetadataSymbol] as Map<string | symbol, ResolverHandlerMetadata> | undefined;
  const map = current ?? new Map<string | symbol, ResolverHandlerMetadata>();

  map.set(propertyKey, {
    argTypes: handlerMetadata.argTypes,
    fieldName: handlerMetadata.fieldName,
    inputClass: handlerMetadata.inputClass,
    nullable: handlerMetadata.nullable,
    outputType: handlerMetadata.outputType,
    type: handlerMetadata.type,
  });
  bag[handlerMetadataSymbol] = map;
}

function defineStandardFieldResolverParameterMetadata(
  metadata: unknown,
  propertyKey: string | symbol,
  parameterIndex: number,
  kind: FieldResolverParameterKind,
): void {
  const bag = getStandardMetadataBag(metadata);
  const current = bag[fieldResolverParameterMetadataSymbol] as
    | Map<string | symbol, Map<number, FieldResolverParameterBindingMetadata>>
    | undefined;
  const methods = current ?? new Map<string | symbol, Map<number, FieldResolverParameterBindingMetadata>>();
  const bindings = methods.get(propertyKey) ?? new Map<number, FieldResolverParameterBindingMetadata>();
  const existing = bindings.get(parameterIndex);

  if (existing) {
    throw new Error(
      `GraphQL field resolver parameter ${String(parameterIndex)} on ${String(propertyKey)} is already bound to ${existing.kind}.`,
    );
  }

  bindings.set(parameterIndex, { index: parameterIndex, kind });
  methods.set(propertyKey, bindings);
  bag[fieldResolverParameterMetadataSymbol] = methods;
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

function normalizeFieldResolverMetadata(
  fieldNameOrOptions: string | FieldResolverOptions | undefined,
): ResolverHandlerMetadata {
  if (typeof fieldNameOrOptions === 'string') {
    return {
      fieldName: fieldNameOrOptions.trim() || undefined,
      type: 'field',
    };
  }

  return {
    fieldName: fieldNameOrOptions?.fieldName?.trim() || undefined,
    nullable: fieldNameOrOptions?.nullable,
    outputType: fieldNameOrOptions?.type,
    type: 'field',
  };
}

function createFieldResolverParameterDecorator(
  kind: FieldResolverParameterKind,
  parameterIndex: number,
): MethodDecoratorLike {
  if (!Number.isSafeInteger(parameterIndex) || parameterIndex < 0) {
    throw new Error(`@${kind === 'parent' ? 'Parent' : 'Context'}() parameter index must be a non-negative integer.`);
  }

  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    const name = kind === 'parent' ? 'Parent' : 'Context';

    if (context.private) {
      throw new Error(`@${name}() cannot be used on private methods.`);
    }

    if (context.static) {
      throw new Error(`@${name}() cannot be used on static methods.`);
    }

    defineStandardFieldResolverParameterMetadata(context.metadata, context.name, parameterIndex, kind);
  };

  return decorator as MethodDecoratorLike;
}

/**
 * Resolver.
 *
 * @param typeName The type name.
 * @returns The resolver result.
 */
export function Resolver(typeName?: string): ClassDecoratorLike {
  const decorator = (value: Function, context: ClassDecoratorContext) => {
    defineStandardResolverMetadata(context.metadata, {
      typeName: normalizeResolverTypeName(typeName, value.name || 'Resolver'),
    });
  };

  return decorator as ClassDecoratorLike;
}

/**
 * Query.
 *
 * @param fieldNameOrOptions The field name or options.
 * @returns The query result.
 */
export function Query(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('query', fieldNameOrOptions);
}

/**
 * Mutation.
 *
 * @param fieldNameOrOptions The field name or options.
 * @returns The mutation result.
 */
export function Mutation(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('mutation', fieldNameOrOptions);
}

/**
 * Subscription.
 *
 * @param fieldNameOrOptions The field name or options.
 * @returns The subscription result.
 */
export function Subscription(fieldNameOrOptions?: string | ResolverMethodOptions): MethodDecoratorLike {
  return createMethodDecorator('subscription', fieldNameOrOptions);
}

/**
 * Marks a public instance method as the resolver for one field on the object type owned by `@Resolver(typeName)`.
 *
 * @param fieldNameOrOptions Field name or object field resolver options.
 * @returns A TC39 standard method decorator.
 */
export function FieldResolver(fieldNameOrOptions?: string | FieldResolverOptions): MethodDecoratorLike {
  const metadata = normalizeFieldResolverMetadata(fieldNameOrOptions);
  const decorator = (_value: Function, context: ClassMethodDecoratorContext) => {
    if (context.private) {
      throw new Error('@FieldResolver() cannot be used on private methods.');
    }

    if (context.static) {
      throw new Error('@FieldResolver() cannot be used on static methods.');
    }

    defineStandardHandlerMetadata(context.metadata, context.name, metadata);
  };

  return decorator as MethodDecoratorLike;
}

/**
 * Binds a field resolver method parameter to GraphQL's parent/source object.
 *
 * @remarks
 * TC39 standard decorators do not support parameter-decorator syntax, so this
 * standard method decorator records the parameter index explicitly. The default
 * index is `0`.
 *
 * @param parameterIndex Zero-based method parameter index to receive the parent value.
 * @returns A TC39 standard method decorator.
 */
export function Parent(parameterIndex = 0): MethodDecoratorLike {
  return createFieldResolverParameterDecorator('parent', parameterIndex);
}

/**
 * Binds a field resolver method parameter to the active `GraphQLContext`.
 *
 * @remarks
 * TC39 standard decorators do not support parameter-decorator syntax, so this
 * standard method decorator records the parameter index explicitly. The default
 * index is `1`.
 *
 * @param parameterIndex Zero-based method parameter index to receive the context value.
 * @returns A TC39 standard method decorator.
 */
export function Context(parameterIndex = 1): MethodDecoratorLike {
  return createFieldResolverParameterDecorator('context', parameterIndex);
}

/**
 * Arg.
 *
 * @param argName The arg name.
 * @returns The arg result.
 */
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
