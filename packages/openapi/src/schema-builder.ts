import { getDtoBindingSchema, getDtoValidationSchema, type Constructor, type DtoFieldValidationRule, type MetadataPropertyKey } from '@konekti/core';
import type { HandlerDescriptor, HttpMethod } from '@konekti/http';
import {
  type ApiParameterMetadata,
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
  description?: string;
  content: Record<string, OpenApiMediaTypeObject>;
  required?: boolean;
}

export interface OpenApiSecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  in?: 'cookie' | 'header' | 'query';
  name?: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: {
    implicit?: {
      authorizationUrl: string;
      refreshUrl?: string;
      scopes: Record<string, string>;
    };
    password?: {
      tokenUrl: string;
      refreshUrl?: string;
      scopes: Record<string, string>;
    };
    clientCredentials?: {
      tokenUrl: string;
      refreshUrl?: string;
      scopes: Record<string, string>;
    };
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      refreshUrl?: string;
      scopes: Record<string, string>;
    };
  };
  openIdConnectUrl?: string;
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
  deprecated?: boolean;
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
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
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
  const typeSet = new Set(values.map((value) => inferEnumValueType(value)));

  return {
    enum: [...values],
    ...(typeSet.size === 1 && values.length > 0 ? { type: inferEnumValueType(values[0]) } : {}),
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

interface RuleProfile {
  enumEachRule: Extract<DtoFieldValidationRule, { kind: 'enum' }> | undefined;
  enumRule: Extract<DtoFieldValidationRule, { kind: 'enum' }> | undefined;
  hasArrayRule: boolean;
  hasBooleanRule: boolean;
  hasDateRule: boolean;
  hasEachBooleanRule: boolean;
  hasEachIntRule: boolean;
  hasEachNumberRule: boolean;
  hasIntRule: boolean;
  hasNumberRule: boolean;
  hasObjectRule: boolean;
  hasStringRule: boolean;
  hasStringRuleForEach: boolean;
  maxLength: number | undefined;
  maximum: number | undefined;
  minLength: number | undefined;
  minimum: number | undefined;
  nestedEachRule: Extract<DtoFieldValidationRule, { kind: 'nested' }> | undefined;
  nestedRule: Extract<DtoFieldValidationRule, { kind: 'nested' }> | undefined;
  stringFormat: OpenApiSchemaObject['format'];
}

const ruleProfileCache = new WeakMap<readonly DtoFieldValidationRule[], RuleProfile>();

function resolveValidatorStringFormat(
  validatorRule: Extract<DtoFieldValidationRule, { kind: 'validatorjs' }>,
): OpenApiSchemaObject['format'] {
  if (validatorRule.validator === 'email') {
    return 'email';
  }

  if (validatorRule.validator === 'uuid') {
    return 'uuid';
  }

  if (validatorRule.validator === 'url') {
    return 'uri';
  }

  if (validatorRule.validator === 'dateString' || validatorRule.validator === 'iso8601') {
    return 'date-time';
  }

  return undefined;
}

function createRuleProfile(): RuleProfile {
  return {
    enumEachRule: undefined,
    enumRule: undefined,
    hasArrayRule: false,
    hasBooleanRule: false,
    hasDateRule: false,
    hasEachBooleanRule: false,
    hasEachIntRule: false,
    hasEachNumberRule: false,
    hasIntRule: false,
    hasNumberRule: false,
    hasObjectRule: false,
    hasStringRule: false,
    hasStringRuleForEach: false,
    maxLength: undefined,
    maximum: undefined,
    minLength: undefined,
    minimum: undefined,
    nestedEachRule: undefined,
    nestedRule: undefined,
    stringFormat: undefined,
  };
}

function applyRuleToProfile(profile: RuleProfile, rule: DtoFieldValidationRule): void {
  if (rule.kind === 'nested') {
    profile.nestedRule ??= rule;

    if (rule.each) {
      profile.nestedEachRule ??= rule;
    }

    return;
  }

  if (rule.kind === 'array') {
    profile.hasArrayRule = true;
    return;
  }

  if (rule.kind === 'enum') {
    profile.enumRule ??= rule;

    if (rule.each) {
      profile.enumEachRule ??= rule;
    }

    return;
  }

  if (rule.kind === 'int') {
    profile.hasIntRule = true;

    if (rule.each) {
      profile.hasEachIntRule = true;
    }

    return;
  }

  if (rule.kind === 'number') {
    profile.hasNumberRule = true;

    if (rule.each) {
      profile.hasEachNumberRule = true;
    }

    return;
  }

  if (rule.kind === 'boolean') {
    profile.hasBooleanRule = true;

    if (rule.each) {
      profile.hasEachBooleanRule = true;
    }

    return;
  }

  if (rule.kind === 'date') {
    profile.hasDateRule = true;
    return;
  }

  if (rule.kind === 'object') {
    profile.hasObjectRule = true;
    return;
  }

  if (rule.kind === 'string') {
    profile.hasStringRule = true;
    return;
  }

  if (rule.kind === 'minLength') {
    if (rule.each) {
      profile.hasStringRuleForEach = true;
      return;
    }

    profile.minLength = rule.value;
    return;
  }

  if (rule.kind === 'maxLength') {
    if (rule.each) {
      profile.hasStringRuleForEach = true;
      return;
    }

    profile.maxLength = rule.value;
    return;
  }

  if (rule.kind === 'min' && !rule.each) {
    profile.minimum = rule.value;
    return;
  }

  if (rule.kind === 'max' && !rule.each) {
    profile.maximum = rule.value;
    return;
  }

  if (rule.kind === 'validatorjs') {
    const nextFormat = resolveValidatorStringFormat(rule);

    if (nextFormat) {
      profile.stringFormat = nextFormat;
    }
  }
}

function getRuleProfile(rules: readonly DtoFieldValidationRule[]): RuleProfile {
  const cached = ruleProfileCache.get(rules);

  if (cached) {
    return cached;
  }

  const profile = createRuleProfile();

  for (const rule of rules) {
    applyRuleToProfile(profile, rule);
  }

  ruleProfileCache.set(rules, profile);
  return profile;
}

function inferPrimitiveTypeFromRules(
  rules: readonly DtoFieldValidationRule[],
  context: BuildSchemaContext,
): OpenApiSchemaObject | undefined {
  const profile = getRuleProfile(rules);
  const nestedSchema = inferNestedSchema(profile.nestedRule, context);

  if (nestedSchema) {
    return nestedSchema;
  }

  if (profile.hasArrayRule) {
    return { items: inferEachItemSchema(rules, context, profile) ?? {}, type: 'array' };
  }

  if (profile.enumRule) {
    return createEnumSchema(profile.enumRule.values);
  }

  if (profile.hasIntRule) {
    return { type: 'integer' };
  }

  if (profile.hasNumberRule) {
    return { type: 'number' };
  }

  if (profile.hasBooleanRule) {
    return { type: 'boolean' };
  }

  if (profile.hasDateRule) {
    return { format: 'date-time', type: 'string' };
  }

  if (profile.hasObjectRule) {
    return { additionalProperties: true, type: 'object' };
  }

  if (profile.hasStringRule) {
    return { type: 'string' };
  }

  return undefined;
}

function inferEachItemSchema(
  rules: readonly DtoFieldValidationRule[],
  context: BuildSchemaContext,
  profile = getRuleProfile(rules),
): OpenApiSchemaObject | undefined {
  if (profile.nestedEachRule) {
    const resolvedDto = resolveNestedDto(profile.nestedEachRule.dto);
    return createSchemaRef(getDtoSchemaName(resolvedDto, context));
  }

  if (profile.enumEachRule) {
    return createEnumSchema(profile.enumEachRule.values);
  }

  if (profile.hasStringRule || profile.hasStringRuleForEach) {
    return { type: 'string' };
  }

  if (profile.hasEachIntRule) {
    return { type: 'integer' };
  }

  if (profile.hasEachNumberRule) {
    return { type: 'number' };
  }

  if (profile.hasEachBooleanRule) {
    return { type: 'boolean' };
  }

  return undefined;
}

function applyValidationConstraints(schema: OpenApiSchemaObject, rules: readonly DtoFieldValidationRule[]): OpenApiSchemaObject {
  const nextSchema: OpenApiSchemaObject = { ...schema };
  const profile = getRuleProfile(rules);

  if (nextSchema.type === 'string') {
    if (profile.minLength !== undefined) {
      nextSchema.minLength = profile.minLength;
    }

    if (profile.maxLength !== undefined) {
      nextSchema.maxLength = profile.maxLength;
    }

    if (profile.stringFormat !== undefined) {
      nextSchema.format = profile.stringFormat;
    }
  }

  if (nextSchema.type === 'number' || nextSchema.type === 'integer') {
    if (profile.minimum !== undefined) {
      nextSchema.minimum = profile.minimum;
    }

    if (profile.maximum !== undefined) {
      nextSchema.maximum = profile.maximum;
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

    const inferred = inferPrimitiveTypeFromRules(rules, context) ?? {};
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
    const inferred = inferPrimitiveTypeFromRules(rules, context) ?? {};
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

function createExplicitRequestBody(methodMeta: MethodApiMetadata | undefined): OpenApiRequestBodyObject | undefined {
  const requestBodyMeta = methodMeta?.requestBody;

  if (!requestBodyMeta) {
    return undefined;
  }

  const content = requestBodyMeta.content
    ? requestBodyMeta.content
    : requestBodyMeta.schema
      ? {
          'application/json': {
            schema: requestBodyMeta.schema,
          },
        }
      : undefined;

  if (!content) {
    return undefined;
  }

  return {
    content,
    ...(requestBodyMeta.description !== undefined ? { description: requestBodyMeta.description } : {}),
    ...(requestBodyMeta.required !== undefined ? { required: requestBodyMeta.required } : {}),
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

function createExplicitParameter(parameter: ApiParameterMetadata): OpenApiParameterObject {
  const source = parameter.in;
  const schema = alignParameterSchemaWithRuntimeBindingContract(parameter.schema ?? { type: 'string' }, source);
  const isRequired = source === 'path' ? true : parameter.required;

  return {
    in: source,
    name: parameter.name,
    ...(parameter.description !== undefined ? { description: parameter.description } : {}),
    ...(isRequired !== undefined ? { required: isRequired } : {}),
    schema,
  };
}

function mergeOperationParameters(
  inferred: OpenApiParameterObject[],
  explicit: ApiParameterMetadata[] | undefined,
): OpenApiParameterObject[] {
  if (!explicit || explicit.length === 0) {
    return inferred;
  }

  const merged = new Map<string, OpenApiParameterObject>();

  for (const parameter of inferred) {
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  for (const parameter of explicit) {
    const explicitParameter = createExplicitParameter(parameter);
    merged.set(`${explicitParameter.in}:${explicitParameter.name}`, explicitParameter);
  }

  return Array.from(merged.values());
}

function mergeOperationRequestBody(
  inferred: OpenApiRequestBodyObject | undefined,
  methodMeta: MethodApiMetadata | undefined,
): OpenApiRequestBodyObject | undefined {
  const explicit = createExplicitRequestBody(methodMeta);

  if (!explicit) {
    return inferred;
  }

  if (!inferred) {
    return explicit;
  }

  return {
    ...inferred,
    ...explicit,
  };
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
  if (methodMeta?.securityRequirements && methodMeta.securityRequirements.length > 0) {
    return methodMeta.securityRequirements.map((requirement) => ({ ...requirement }));
  }

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
  const parameters = mergeOperationParameters(createParameters(descriptor.route.request, context), methodMeta?.parameters);
  const requestBody = mergeOperationRequestBody(
    createRequestBody(descriptor.route.request, componentSchemas, context),
    methodMeta,
  );

  return {
    operationId: normalizeOperationId(descriptor),
    responses,
    tags: resolveControllerTags(descriptor),
    ...(methodMeta?.operation?.summary !== undefined && { summary: methodMeta.operation.summary }),
    ...(methodMeta?.operation?.description !== undefined && { description: methodMeta.operation.description }),
    ...(methodMeta?.operation?.deprecated !== undefined && { deprecated: methodMeta.operation.deprecated }),
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
): BuiltOperationEntry | undefined {
  const openApiPath = expressPathToOpenApi(descriptor.route.path);
  const method = descriptor.route.method.toLowerCase() as OpenApiOperationMethod;
  const methodMeta = getMethodApiMetadata(descriptor.controllerToken, descriptor.methodName);

  if (methodMeta?.excludeEndpoint === true) {
    return undefined;
  }

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
  configuredSecuritySchemes: Record<string, OpenApiSecuritySchemeObject> | undefined,
): OpenApiComponentsObject {
  const securitySchemes = {
    ...(configuredSecuritySchemes ?? {}),
    ...(hasBearerAuth && !(configuredSecuritySchemes && 'bearerAuth' in configuredSecuritySchemes)
      ? {
          bearerAuth: {
            bearerFormat: 'JWT',
            scheme: 'bearer',
            type: 'http',
          } satisfies OpenApiSecuritySchemeObject,
        }
      : {}),
  };

  return {
    ...(Object.keys(componentSchemas).length > 0 && { schemas: componentSchemas }),
    ...(Object.keys(securitySchemes).length > 0 && { securitySchemes }),
  };
}

function registerExtraModels(
  extraModels: readonly Constructor[] | undefined,
  componentSchemas: Record<string, OpenApiSchemaObject>,
  context: BuildSchemaContext,
): void {
  for (const model of extraModels ?? []) {
    ensureComponentSchema(model, componentSchemas, context);
  }
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

  registerExtraModels(options.extraModels, componentSchemas, context);

  for (const descriptor of options.descriptors) {
    const entry = buildOperationEntry(
      descriptor,
      componentSchemas,
      defaultErrorResponsesPolicy,
      context,
    );

    if (!entry) {
      continue;
    }

    const { method, openApiPath, operation, requiresBearerAuth } = entry;

    if (requiresBearerAuth) {
      hasBearerAuth = true;
    }

    const pathItem = paths[openApiPath] ?? {};
    pathItem[method] = operation;
    paths[openApiPath] = pathItem;
  }

  const components = createOpenApiComponents(componentSchemas, hasBearerAuth, options.securitySchemes);

  const document: OpenApiDocument = {
    ...(Object.keys(components).length > 0 && { components }),
    info: {
      title: options.title,
      version: options.version,
    },
    openapi: '3.1.0',
    paths,
  };

  return options.documentTransform ? options.documentTransform(document) : document;
}
