import { getDtoBindingSchema, getDtoValidationSchema, type Constructor, type DtoFieldValidationRule, type MetadataPropertyKey } from '@konekti/core';
import type { HandlerDescriptor, HttpMethod } from '@konekti/http';
import {
  getControllerTags,
  getMethodApiMetadata,
  type ApiResponseMetadata,
  type MethodApiMetadata,
} from './decorators.js';

type OpenApiOperationMethod = Lowercase<HttpMethod>;

export interface OpenApiInfoObject {
  title: string;
  version: string;
}

export interface OpenApiResponseObject {
  description: string;
  content?: Record<string, OpenApiMediaTypeObject>;
}

export interface OpenApiSecurityRequirementObject {
  [scheme: string]: string[];
}

export interface OpenApiSchemaObject {
  $ref?: string;
  type?: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';
  format?: string;
  description?: string;
  properties?: Record<string, OpenApiSchemaObject>;
  items?: OpenApiSchemaObject;
  required?: string[];
  enum?: unknown[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface OpenApiParameterObject {
  name: string;
  in: 'cookie' | 'header' | 'path' | 'query';
  required?: boolean;
  schema: OpenApiSchemaObject;
  description?: string;
}

export interface OpenApiMediaTypeObject {
  schema: OpenApiSchemaObject;
}

export interface OpenApiRequestBodyObject {
  content: Record<string, OpenApiMediaTypeObject>;
  required?: boolean;
}

export interface OpenApiSecuritySchemeObject {
  type: 'http';
  scheme: 'bearer';
  bearerFormat?: string;
}

export interface OpenApiComponentsObject {
  schemas?: Record<string, OpenApiSchemaObject>;
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
}

export interface OpenApiOperationObject {
  operationId: string;
  tags: string[];
  summary?: string;
  description?: string;
  parameters?: OpenApiParameterObject[];
  responses: Record<string, OpenApiResponseObject>;
  requestBody?: OpenApiRequestBodyObject;
  security?: OpenApiSecurityRequirementObject[];
}

export interface OpenApiPathItemObject {
  [method: string]: OpenApiOperationObject | undefined;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfoObject;
  paths: Record<string, OpenApiPathItemObject>;
  components?: OpenApiComponentsObject;
}

export interface BuildOpenApiDocumentOptions {
  defaultErrorResponsesPolicy?: DefaultErrorResponsesPolicy;
  descriptors: readonly HandlerDescriptor[];
  title: string;
  version: string;
}

export type DefaultErrorResponsesPolicy = 'inject' | 'omit';

function expressPathToOpenApi(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

function resolveControllerTags(descriptor: HandlerDescriptor): string[] {
  const decorated = getControllerTags(descriptor.controllerToken);
  if (decorated && decorated.length > 0) {
    return decorated;
  }
  return [descriptor.controllerToken.name || 'Controller'];
}

function normalizeOperationId(descriptor: HandlerDescriptor): string {
  const tag = resolveControllerTags(descriptor)[0] ?? 'Controller';
  const path = expressPathToOpenApi(descriptor.route.path)
    .replaceAll('/', '_')
    .replaceAll('{', '')
    .replaceAll('}', '')
    .replaceAll('-', '_');

  return `${tag}_${descriptor.methodName}_${descriptor.route.method.toLowerCase()}${path}`;
}

type DtoBindingEntry = ReturnType<typeof getDtoBindingSchema>[number];
type DtoValidationEntry = ReturnType<typeof getDtoValidationSchema>[number];

interface CollectedDtoEntry {
  binding: DtoBindingEntry | undefined;
  name: string;
  validation: DtoValidationEntry | undefined;
}

interface BuildSchemaContext {
  dtoEntries: WeakMap<Constructor, CollectedDtoEntry[]>;
  dtoSchemaNames: WeakMap<Constructor, Map<string, string>>;
  usedSchemaNames: Set<string>;
}

function propertyName(propertyKey: string | number | symbol): string {
  return typeof propertyKey === 'string' ? propertyKey : String(propertyKey);
}

function collectDtoEntries(dto: Constructor, context: BuildSchemaContext): CollectedDtoEntry[] {
  const cachedEntries = context.dtoEntries.get(dto);

  if (cachedEntries) {
    return cachedEntries;
  }

  const bindingEntries = getDtoBindingSchema(dto);
  const validationEntries = getDtoValidationSchema(dto);
  const bindingMap = new Map(bindingEntries.map((entry: DtoBindingEntry) => [entry.propertyKey, entry]));
  const validationMap = new Map(validationEntries.map((entry: DtoValidationEntry) => [entry.propertyKey, entry]));
  const propertyKeys = new Set<MetadataPropertyKey>([
    ...(Array.from(bindingMap.keys()) as MetadataPropertyKey[]),
    ...(Array.from(validationMap.keys()) as MetadataPropertyKey[]),
  ]);

  const entries = Array.from(propertyKeys).map((propertyKey) => ({
    binding: bindingMap.get(propertyKey),
    name: propertyName(propertyKey),
    validation: validationMap.get(propertyKey),
  }));

  context.dtoEntries.set(dto, entries);
  return entries;
}

function getDtoSchemaName(dto: Constructor, context: BuildSchemaContext, suffix = ''): string {
  let perDto = context.dtoSchemaNames.get(dto);

  if (!perDto) {
    perDto = new Map<string, string>();
    context.dtoSchemaNames.set(dto, perDto);
  }

  const cached = perDto.get(suffix);

  if (cached) {
    return cached;
  }

  const baseName = `${dto.name || 'AnonymousDto'}${suffix}`;
  let candidate = baseName;
  let index = 2;

  while (context.usedSchemaNames.has(candidate)) {
    candidate = `${baseName}_${String(index)}`;
    index++;
  }

  context.usedSchemaNames.add(candidate);
  perDto.set(suffix, candidate);
  return candidate;
}

function createSchemaRef(name: string): OpenApiSchemaObject {
  return {
    $ref: `#/components/schemas/${name}`,
  };
}

function resolveNestedDto(dto: Constructor | (() => Constructor)): Constructor {
  if (typeof dto === 'function' && 'prototype' in dto && dto.prototype) {
    return dto as Constructor;
  }

  return (dto as () => Constructor)();
}

function inferEnumValueType(value: unknown): 'boolean' | 'number' | 'string' {
  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  return 'string';
}

function createEnumSchema(values: readonly unknown[]): OpenApiSchemaObject {
  return {
    enum: [...values],
    type: inferEnumValueType(values[0]),
  };
}

function inferNestedSchema(
  nestedRule: Extract<DtoFieldValidationRule, { kind: 'nested' }> | undefined,
  context: BuildSchemaContext,
): OpenApiSchemaObject | undefined {
  if (!nestedRule) {
    return undefined;
  }

  const resolvedDto = resolveNestedDto(nestedRule.dto);
  const schemaName = getDtoSchemaName(resolvedDto, context);

  if (nestedRule.each) {
    return { items: createSchemaRef(schemaName), type: 'array' };
  }

  return createSchemaRef(schemaName);
}

function inferPrimitiveTypeFromRules(
  rules: readonly DtoFieldValidationRule[],
  context: BuildSchemaContext,
): OpenApiSchemaObject | undefined {
  const hasRule = <TKind extends DtoFieldValidationRule['kind']>(kind: TKind) =>
    rules.find((rule): rule is Extract<DtoFieldValidationRule, { kind: TKind }> => rule.kind === kind);

  const nestedRule = hasRule('nested');
  const arrayRule = hasRule('array');
  const intRule = hasRule('int');
  const numberRule = hasRule('number');
  const booleanRule = hasRule('boolean');
  const dateRule = hasRule('date');
  const objectRule = hasRule('object');
  const stringRule = hasRule('string');
  const enumRule = hasRule('enum');

  const nestedSchema = inferNestedSchema(nestedRule, context);

  if (nestedSchema) {
    return nestedSchema;
  }

  if (arrayRule) {
    return { items: inferEachItemSchema(rules, context) ?? {}, type: 'array' };
  }

  if (enumRule) {
    return createEnumSchema(enumRule.values);
  }

  if (intRule) {
    return { type: 'integer' };
  }

  if (numberRule) {
    return { type: 'number' };
  }

  if (booleanRule) {
    return { type: 'boolean' };
  }

  if (dateRule) {
    return { format: 'date-time', type: 'string' };
  }

  if (objectRule) {
    return { additionalProperties: true, type: 'object' };
  }

  if (stringRule) {
    return { type: 'string' };
  }

  return undefined;
}

function inferEachItemSchema(
  rules: readonly DtoFieldValidationRule[],
  context: BuildSchemaContext,
): OpenApiSchemaObject | undefined {
  const nestedRule = rules.find(
    (rule): rule is Extract<DtoFieldValidationRule, { kind: 'nested' }> => rule.kind === 'nested' && Boolean(rule.each),
  );

  if (nestedRule) {
    const resolvedDto = resolveNestedDto(nestedRule.dto);
    return createSchemaRef(getDtoSchemaName(resolvedDto, context));
  }

  const enumRule = rules.find(
    (rule): rule is Extract<DtoFieldValidationRule, { kind: 'enum' }> => rule.kind === 'enum' && Boolean(rule.each),
  );

  if (enumRule) {
    return createEnumSchema(enumRule.values);
  }

  if (rules.some((rule) => rule.kind === 'string' || ((rule.kind === 'minLength' || rule.kind === 'maxLength') && rule.each))) {
    return { type: 'string' };
  }

  if (rules.some((rule) => rule.kind === 'int' && Boolean(rule.each))) {
    return { type: 'integer' };
  }

  if (rules.some((rule) => rule.kind === 'number' && Boolean(rule.each))) {
    return { type: 'number' };
  }

  if (rules.some((rule) => rule.kind === 'boolean' && Boolean(rule.each))) {
    return { type: 'boolean' };
  }

  return undefined;
}

function applyValidationConstraints(schema: OpenApiSchemaObject, rules: readonly DtoFieldValidationRule[]): OpenApiSchemaObject {
  const nextSchema: OpenApiSchemaObject = { ...schema };

  for (const rule of rules) {
    if (rule.kind === 'minLength' && !rule.each && nextSchema.type === 'string') {
      nextSchema.minLength = rule.value;
    }

    if (rule.kind === 'maxLength' && !rule.each && nextSchema.type === 'string') {
      nextSchema.maxLength = rule.value;
    }

    if (rule.kind === 'min' && !rule.each && (nextSchema.type === 'number' || nextSchema.type === 'integer')) {
      nextSchema.minimum = rule.value;
    }

    if (rule.kind === 'max' && !rule.each && (nextSchema.type === 'number' || nextSchema.type === 'integer')) {
      nextSchema.maximum = rule.value;
    }

    if (rule.kind === 'validatorjs' && nextSchema.type === 'string') {
      if (rule.validator === 'email') {
        nextSchema.format = 'email';
      }

      if (rule.validator === 'uuid') {
        nextSchema.format = 'uuid';
      }

      if (rule.validator === 'url') {
        nextSchema.format = 'uri';
      }

      if (rule.validator === 'dateString' || rule.validator === 'iso8601') {
        nextSchema.format = 'date-time';
      }
    }
  }

  return nextSchema;
}

function isPropertyRequired(binding: DtoBindingEntry | undefined, validation: DtoValidationEntry | undefined): boolean {
  if (binding?.metadata.optional) {
    return false;
  }

  if (validation?.rules.some((rule: DtoFieldValidationRule) => rule.kind === 'optional')) {
    return false;
  }

  return true;
}

function ensureComponentSchemaFromEntries(
  schemaName: string,
  entries: readonly CollectedDtoEntry[],
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): OpenApiSchemaObject {
  if (componentSchemas[schemaName]) {
    return createSchemaRef(schemaName);
  }

  componentSchemas[schemaName] = {
    additionalProperties: false,
    properties: {},
    type: 'object',
  };

  const { properties, required } = buildComponentSchemaShape(entries, componentSchemas, context);

  componentSchemas[schemaName] = {
    additionalProperties: false,
    properties,
    ...(required.length > 0 && { required }),
    type: 'object',
  };

  return createSchemaRef(schemaName);
}

function ensureNestedSchemasFromRules(
  rules: readonly DtoFieldValidationRule[],
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): void {
  for (const rule of rules) {
    if (rule.kind === 'nested') {
      ensureComponentSchema(resolveNestedDto(rule.dto), componentSchemas, context);
    }
  }
}

function buildComponentSchemaShape(
  entries: readonly CollectedDtoEntry[],
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): {
  properties: Record<string, OpenApiSchemaObject>;
  required: string[];
} {
  const properties: Record<string, OpenApiSchemaObject> = {};
  const required: string[] = [];

  for (const entry of entries) {
    const rules = entry.validation?.rules ?? [];
    ensureNestedSchemasFromRules(rules, componentSchemas, context);

    const inferred = inferPrimitiveTypeFromRules(rules, context) ?? { type: 'string' };
    properties[entry.name] = applyValidationConstraints(inferred, rules);

    if (isPropertyRequired(entry.binding, entry.validation)) {
      required.push(entry.name);
    }
  }

  return { properties, required };
}

function ensureComponentSchema(
  dto: Constructor,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): OpenApiSchemaObject {
  const schemaName = getDtoSchemaName(dto, context);
  return ensureComponentSchemaFromEntries(schemaName, collectDtoEntries(dto, context), componentSchemas, context);
}

function createParameters(
  dto: Constructor | undefined,
  context: BuildSchemaContext,
): OpenApiParameterObject[] {
  if (!dto) {
    return [];
  }

  const entries = collectDtoEntries(dto, context).filter(
    (entry): entry is typeof entry & { binding: DtoBindingEntry } =>
      entry.binding?.metadata.source === 'path'
      || entry.binding?.metadata.source === 'query'
      || entry.binding?.metadata.source === 'header'
      || entry.binding?.metadata.source === 'cookie',
  );

  return entries.map((entry) => {
    const source = entry.binding.metadata.source as 'cookie' | 'header' | 'path' | 'query';
    const rules = entry.validation?.rules ?? [];
    const inferred = inferPrimitiveTypeFromRules(rules, context) ?? { type: 'string' as const };
    const schema = alignParameterSchemaWithRuntimeBindingContract(applyValidationConstraints(inferred, rules), source);
    const isRequired = source === 'path' ? true : isPropertyRequired(entry.binding, entry.validation);

    return {
      in: source,
      name: entry.binding.metadata.key ?? entry.name,
      required: isRequired,
      schema,
    };
  });
}

function ensureErrorResponseSchema(componentSchemas: Record<string, OpenApiSchemaObject>): OpenApiSchemaObject {
  const schemaName = 'ErrorResponse';

  if (!componentSchemas[schemaName]) {
    componentSchemas[schemaName] = {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            details: {
              items: {
                additionalProperties: false,
                properties: {
                  code: { type: 'string' },
                  field: { type: 'string' },
                  message: { type: 'string' },
                  source: {
                    enum: ['path', 'query', 'header', 'cookie', 'body'],
                    type: 'string',
                  },
                },
                required: ['code', 'message'],
                type: 'object',
              },
              type: 'array',
            },
            message: { type: 'string' },
            meta: {
              additionalProperties: true,
              type: 'object',
            },
            requestId: { type: 'string' },
            status: { type: 'integer' },
          },
          required: ['code', 'status', 'message'],
          type: 'object',
        },
      },
      required: ['error'],
      type: 'object',
    };
  }

  return createSchemaRef(schemaName);
}

function addDefaultErrorResponses(
  responses: Record<string, OpenApiResponseObject>,
  componentSchemas: Record<string, OpenApiSchemaObject>,
): void {
  const errorSchema = ensureErrorResponseSchema(componentSchemas);
  const defaultErrorResponses: Record<string, string> = {
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '403': 'Forbidden',
    '404': 'Not Found',
    '500': 'Internal Server Error',
  };

  for (const [status, description] of Object.entries(defaultErrorResponses)) {
    if (responses[status]) {
      continue;
    }

    responses[status] = {
      content: {
        'application/json': {
          schema: errorSchema,
        },
      },
      description,
    };
  }
}

function createRequestBody(
  dto: Constructor | undefined,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): OpenApiRequestBodyObject | undefined {
  if (!dto) {
    return undefined;
  }

  const dtoEntries = collectDtoEntries(dto, context);
  const entries = dtoEntries.filter((entry) => entry.binding?.metadata.source === 'body');

  if (entries.length === 0) {
    return undefined;
  }

  const schemaName = entries.length === dtoEntries.length
    ? getDtoSchemaName(dto, context)
    : getDtoSchemaName(dto, context, 'RequestBody');
  ensureComponentSchemaFromEntries(schemaName, entries, componentSchemas, context);

  return {
    content: {
      'application/json': {
        schema: createSchemaRef(schemaName),
      },
    },
    ...(entries.some((entry) => isPropertyRequired(entry.binding, entry.validation)) ? { required: true } : {}),
  };
}

function scalarizeArraySchemaItems(items: OpenApiSchemaObject | undefined): OpenApiSchemaObject {
  if (!items || items.$ref !== undefined || items.type === undefined || items.type === 'array' || items.type === 'object') {
    return { type: 'string' };
  }

  return {
    type: items.type,
    ...(items.format !== undefined && { format: items.format }),
    ...(items.enum !== undefined && { enum: items.enum }),
  };
}

function alignParameterSchemaWithRuntimeBindingContract(
  schema: OpenApiSchemaObject,
  source: 'cookie' | 'header' | 'path' | 'query',
): OpenApiSchemaObject {
  let aligned = schema;

  if (aligned.$ref !== undefined) {
    aligned = { type: 'string' };
  }

  if (aligned.type === 'object') {
    aligned = { type: 'string' };
  }

  if (aligned.type === 'array' && aligned.items) {
    if (aligned.items.$ref !== undefined || aligned.items.type === 'object') {
      aligned = {
        ...aligned,
        items: { type: 'string' },
      };
    }
  }

  if ((source === 'path' || source === 'cookie') && aligned.type === 'array') {
    return scalarizeArraySchemaItems(aligned.items);
  }

  return aligned;
}

function createResponseObject(
  response: ApiResponseMetadata,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): OpenApiResponseObject {
  const schema = response.schema
    ? response.schema
    : response.type
      ? ensureComponentSchema(response.type, componentSchemas, context)
      : undefined;

  return {
    description: response.description ?? 'OK',
    ...(schema
      ? {
          content: {
            'application/json': {
              schema,
            },
          },
        }
      : {}),
  };
}

function createOperationResponses(
  descriptor: HandlerDescriptor,
  methodMeta: MethodApiMetadata | undefined,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  defaultErrorResponsesPolicy: DefaultErrorResponsesPolicy,
  context: BuildSchemaContext,
): Record<string, OpenApiResponseObject> {
  const responses: Record<string, OpenApiResponseObject> = {};

  if (methodMeta?.responses && methodMeta.responses.length > 0) {
    for (const response of methodMeta.responses) {
      responses[String(response.status)] = createResponseObject(response, componentSchemas, context);
    }
  } else {
    responses[String(descriptor.route.successStatus ?? 200)] = { description: 'OK' };
  }

  if (defaultErrorResponsesPolicy === 'inject') {
    addDefaultErrorResponses(responses, componentSchemas);
  }

  return responses;
}

function createOperationSecurity(
  methodMeta: MethodApiMetadata | undefined,
): OpenApiSecurityRequirementObject[] | undefined {
  if (!methodMeta?.security || methodMeta.security.length === 0) {
    return undefined;
  }

  return methodMeta.security.map((scheme) => ({ [scheme]: [] }));
}

function hasBearerAuthRequirement(security: OpenApiSecurityRequirementObject[] | undefined): boolean {
  return Boolean(security?.some((requirement) => Object.keys(requirement).includes('bearerAuth')));
}

function createOperationObject(
  descriptor: HandlerDescriptor,
  methodMeta: MethodApiMetadata | undefined,
  responses: Record<string, OpenApiResponseObject>,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  security: OpenApiSecurityRequirementObject[] | undefined,
  context: BuildSchemaContext,
): OpenApiOperationObject {
  const parameters = createParameters(descriptor.route.request, context);
  const requestBody = createRequestBody(descriptor.route.request, componentSchemas, context);

  return {
    operationId: normalizeOperationId(descriptor),
    responses,
    tags: resolveControllerTags(descriptor),
    ...(methodMeta?.operation?.summary !== undefined && { summary: methodMeta.operation.summary }),
    ...(methodMeta?.operation?.description !== undefined && { description: methodMeta.operation.description }),
    ...(parameters.length > 0 && { parameters }),
    ...(requestBody !== undefined && { requestBody }),
    ...(security !== undefined && { security }),
  };
}

interface BuiltOperationEntry {
  method: OpenApiOperationMethod;
  openApiPath: string;
  operation: OpenApiOperationObject;
  requiresBearerAuth: boolean;
}

function buildOperationEntry(
  descriptor: HandlerDescriptor,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  defaultErrorResponsesPolicy: DefaultErrorResponsesPolicy,
  context: BuildSchemaContext,
): BuiltOperationEntry {
  const openApiPath = expressPathToOpenApi(descriptor.route.path);
  const method = descriptor.route.method.toLowerCase() as OpenApiOperationMethod;
  const methodMeta = getMethodApiMetadata(descriptor.controllerToken, descriptor.methodName);

  const responses = createOperationResponses(
    descriptor,
    methodMeta,
    componentSchemas,
    defaultErrorResponsesPolicy,
    context,
  );
  const security = createOperationSecurity(methodMeta);
  const operation = createOperationObject(descriptor, methodMeta, responses, componentSchemas, security, context);

  return {
    method,
    openApiPath,
    operation,
    requiresBearerAuth: hasBearerAuthRequirement(security),
  };
}

function createOpenApiComponents(
  componentSchemas: Record<string, OpenApiSchemaObject>,
  hasBearerAuth: boolean,
): OpenApiComponentsObject {
  return {
    ...(Object.keys(componentSchemas).length > 0 && { schemas: componentSchemas }),
    ...(hasBearerAuth
      ? {
          securitySchemes: {
            bearerAuth: {
              bearerFormat: 'JWT',
              scheme: 'bearer',
              type: 'http',
            },
          },
        }
      : {}),
  };
}

export function buildOpenApiDocument(options: BuildOpenApiDocumentOptions): OpenApiDocument {
  const paths: Record<string, OpenApiPathItemObject> = {};
  const componentSchemas: Record<string, OpenApiSchemaObject> = {};
  const defaultErrorResponsesPolicy = options.defaultErrorResponsesPolicy ?? 'inject';
  const context: BuildSchemaContext = {
    dtoEntries: new WeakMap(),
    dtoSchemaNames: new WeakMap(),
    usedSchemaNames: new Set(defaultErrorResponsesPolicy === 'inject' ? ['ErrorResponse'] : []),
  };
  let hasBearerAuth = false;

  for (const descriptor of options.descriptors) {
    const { method, openApiPath, operation, requiresBearerAuth } = buildOperationEntry(
      descriptor,
      componentSchemas,
      defaultErrorResponsesPolicy,
      context,
    );

    if (requiresBearerAuth) {
      hasBearerAuth = true;
    }

    const pathItem = paths[openApiPath] ?? {};
    pathItem[method] = operation;
    paths[openApiPath] = pathItem;
  }

  const components = createOpenApiComponents(componentSchemas, hasBearerAuth);

  return {
    ...(Object.keys(components).length > 0 && { components }),
    info: {
      title: options.title,
      version: options.version,
    },
    openapi: '3.1.0',
    paths,
  };
}
