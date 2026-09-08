import { type Constructor, InvariantError } from '@fluojs/core';
import {
  DtoValidationError,
  parseStandardSchema,
  type StandardSchemaV1Like,
} from '@fluojs/validation';

import { DefaultBinder, prepareBindingRequest } from './adapters/binding.js';
import { BadRequestException } from './exceptions.js';
import { toInputErrorDetail } from './input-error-detail.js';
import { getInputPolicy, InputPolicy, type InputPolicyOptions } from './input-policy.js';
import type { ArgumentResolverContext, Binder } from './types.js';

const schemaDefinitionKey = Symbol.for('fluo.http.schema-binding');
const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A field projected into Standard Schema input before schema validation.
 *
 * The record property is the schema input name; key is its transport alias.
 * Repeated query values preserve their array by default.
 */
export type SchemaBindingField =
  | { readonly source: 'body' | 'path'; readonly key?: string }
  | {
      readonly source: 'query';
      readonly key?: string;
      readonly repeatedQuery?: 'preserve' | 'first' | 'last' | 'reject';
    };

/** Explicit transport mappings and optional body policy for a schema request token. */
export interface SchemaDtoOptions {
  readonly fields: Readonly<Record<string, SchemaBindingField>>;
  readonly policy?: InputPolicyOptions;
}

interface SchemaDefinition {
  readonly schema: StandardSchemaV1Like;
  readonly entries: readonly (readonly [string, SchemaBindingField])[];
  readonly bodyKeys: ReadonlySet<string>;
}

type SchemaTokenOwner = Constructor & {
  readonly [schemaDefinitionKey]: SchemaDefinition;
};

/**
 * Create an opaque RequestDto token whose instance type is the schema output.
 *
 * @param schema Vendor-independent Standard Schema v1 validator.
 * @param options Explicit input field mappings and optional body policies.
 * @returns A token for RequestDto; use InstanceType of this token for handler input.
 * @throws TypeError For unsupported mappings or dangerous input/source keys.
 * @remarks Install StandardSchemaBinder through the Binder seam. Do not construct,
 * subclass, or apply mapped-class DTO helpers to this token. Missing mapped values
 * are omitted so the schema owns required fields, defaults, and transformations.
 */
export function createSchemaDto<Input, Output>(
  schema: StandardSchemaV1Like<Input, Output>,
  options: SchemaDtoOptions,
): Constructor<Output>;
/**
 * Store schema binding metadata on an opaque token that cannot be instantiated.
 *
 * @param schema Standard Schema validator retained for binding.
 * @param options Input mappings and body policy to snapshot.
 * @returns The request token; StandardSchemaBinder produces its handler value.
 */
export function createSchemaDto(
  schema: StandardSchemaV1Like,
  options: SchemaDtoOptions,
): Constructor {
  const entries = Object.entries(options.fields).map(([name, field]) => {
    const key = field.key ?? name;
    if (
      dangerousKeys.has(name)
      || dangerousKeys.has(key)
      || typeof key !== 'string'
      || !['body', 'path', 'query'].includes(field.source)
      || (field.source === 'query'
        && field.repeatedQuery !== undefined
        && !['preserve', 'first', 'last', 'reject'].includes(field.repeatedQuery))
    ) {
      throw new TypeError('Invalid Standard Schema input mapping.');
    }
    return [name, Object.freeze({ ...field, key })] as const;
  });
  class SchemaRequest {
    constructor() {
      throw new InvariantError('Schema request tokens require StandardSchemaBinder.');
    }
  }
  InputPolicy(options.policy ?? {})(SchemaRequest);
  Object.defineProperty(SchemaRequest, schemaDefinitionKey, {
    value: {
      schema,
      entries: Object.freeze(entries),
      bodyKeys: new Set(entries.filter(([, field]) => field.source === 'body').map(([, field]) => field.key)),
    } satisfies SchemaDefinition,
  });
  return SchemaRequest;
}

/**
 * Bind explicit schema request tokens to successful Standard Schema output.
 *
 * Ordinary DTOs delegate to the supplied binder, preserving their converter and
 * validation pipeline. Direct construction defaults to the ordinary DefaultBinder.
 * Runtime applications should pass the default binder supplied by bootstrap.
 */
export class StandardSchemaBinder implements Binder {
  constructor(private readonly fallback: Binder = new DefaultBinder()) {}

  async bind(dto: Constructor, context: ArgumentResolverContext): Promise<unknown> {
    if (!Object.hasOwn(dto, schemaDefinitionKey)) {
      return this.fallback.bind(dto, context);
    }
    const definition = (dto as SchemaTokenOwner)[schemaDefinitionKey];
    const request = prepareBindingRequest(
      context.requestContext.request,
      definition.bodyKeys,
      getInputPolicy(dto, context.handler),
    );
    const input: Record<string, unknown> = {};
    for (const [name, field] of definition.entries) {
      const key = field.key ?? name;
      const source = field.source === 'body' ? request.body : field.source === 'path' ? request.params : request.query;
      let value = source !== undefined && source !== null && Object.hasOwn(source, key)
        ? (source as Record<string, unknown>)[key]
        : undefined;
      if (field.source === 'query' && Array.isArray(value)) {
        if (field.repeatedQuery === 'reject' && value.length > 1) {
          throw new BadRequestException('Repeated query values are not allowed.', {
            details: [toInputErrorDetail({
              code: 'REPEATED_QUERY',
              field: name,
              message: `Repeated query field ${key} is not allowed.`,
              source: 'query',
            })],
          });
        }
        value = field.repeatedQuery === 'first'
          ? value[0]
          : field.repeatedQuery === 'last'
            ? value.at(-1)
            : [...value];
      }
      if (value !== undefined) {
        input[name] = value;
      }
    }
    try {
      return await parseStandardSchema(definition.schema, input);
    } catch (error) {
      if (error instanceof DtoValidationError) {
        throw new BadRequestException(error.message, {
          details: error.issues.map((issue) => toInputErrorDetail(issue)),
        });
      }
      throw error;
    }
  }
}
