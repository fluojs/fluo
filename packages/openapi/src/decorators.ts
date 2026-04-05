import { metadataSymbol, type Constructor, type MetadataPropertyKey } from '@konekti/core';
import type { OpenApiSchemaObject } from './schema-builder.js';

export interface ApiOperationOptions {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ApiResponseOptions {
  status: number;
  description?: string;
  schema?: OpenApiSchemaObject;
  type?: Constructor;
}

export interface ApiParameterOptions {
  description?: string;
  required?: boolean;
  schema?: OpenApiSchemaObject;
}

export interface ApiBodyOptions {
  description?: string;
  required?: boolean;
  schema?: OpenApiSchemaObject;
  content?: Record<string, { schema: OpenApiSchemaObject }>;
}

export interface ApiOperationMetadata {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ApiSecurityRequirementMetadata {
  [scheme: string]: string[];
}

export interface ApiResponseMetadata {
  status: number;
  description?: string;
  schema?: OpenApiSchemaObject;
  type?: Constructor;
}

export interface ApiParameterMetadata {
  name: string;
  in: 'cookie' | 'header' | 'path' | 'query';
  description?: string;
  required?: boolean;
  schema?: OpenApiSchemaObject;
}

export interface ApiBodyMetadata {
  description?: string;
  required?: boolean;
  schema?: OpenApiSchemaObject;
  content?: Record<string, { schema: OpenApiSchemaObject }>;
}

export interface MethodApiMetadata {
  operation?: ApiOperationMetadata;
  responses: ApiResponseMetadata[];
  parameters?: ApiParameterMetadata[];
  requestBody?: ApiBodyMetadata;
  security?: string[];
  securityRequirements?: ApiSecurityRequirementMetadata[];
  excludeEndpoint?: boolean;
}

const openApiControllerTagsKey = Symbol.for('konekti.openapi.controller-tags');
const openApiMethodOperationKey = Symbol.for('konekti.openapi.method-operation');
const openApiMethodResponsesKey = Symbol.for('konekti.openapi.method-responses');
const openApiMethodParametersKey = Symbol.for('konekti.openapi.method-parameters');
const openApiMethodRequestBodyKey = Symbol.for('konekti.openapi.method-request-body');
const openApiMethodSecurityKey = Symbol.for('konekti.openapi.method-security');
const openApiMethodSecurityRequirementsKey = Symbol.for('konekti.openapi.method-security-requirements');
const openApiMethodExcludeEndpointKey = Symbol.for('konekti.openapi.method-exclude-endpoint');

type MetadataBag = Record<PropertyKey, unknown>;

function getMetadataBag(target: object): MetadataBag | undefined {
  void metadataSymbol;
  return (target as Record<symbol, MetadataBag | undefined>)[metadataSymbol];
}

function cloneUnknown<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneUnknown(entry)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const clone: Record<PropertyKey, unknown> = {};

  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneUnknown((value as Record<PropertyKey, unknown>)[key]);
  }

  return clone as T;
}

function cloneApiOperationMetadata(operation: ApiOperationMetadata | undefined): ApiOperationMetadata | undefined {
  if (!operation) {
    return undefined;
  }

  return {
    deprecated: operation.deprecated,
    description: operation.description,
    summary: operation.summary,
  };
}

function cloneApiSecurityRequirementMetadata(
  requirement: ApiSecurityRequirementMetadata,
): ApiSecurityRequirementMetadata {
  const clone: ApiSecurityRequirementMetadata = {};

  for (const [scheme, scopes] of Object.entries(requirement)) {
    clone[scheme] = [...scopes];
  }

  return clone;
}

function cloneApiResponseMetadata(response: ApiResponseMetadata): ApiResponseMetadata {
  return {
    description: response.description,
    schema: cloneUnknown(response.schema),
    status: response.status,
    type: response.type,
  };
}

function cloneApiParameterMetadata(parameter: ApiParameterMetadata): ApiParameterMetadata {
  return {
    description: parameter.description,
    in: parameter.in,
    name: parameter.name,
    required: parameter.required,
    schema: cloneUnknown(parameter.schema),
  };
}

function cloneApiBodyMetadata(requestBody: ApiBodyMetadata): ApiBodyMetadata {
  return {
    ...(requestBody.content !== undefined ? { content: cloneUnknown(requestBody.content) } : {}),
    ...(requestBody.description !== undefined ? { description: requestBody.description } : {}),
    ...(requestBody.required !== undefined ? { required: requestBody.required } : {}),
    ...(requestBody.schema !== undefined ? { schema: cloneUnknown(requestBody.schema) } : {}),
  };
}

/**
 * Read tags registered via `@ApiTag` on a controller class.
 *
 * @param target Controller class token.
 * @returns A defensive copy of registered tags, or `undefined` when no tags are present.
 */
export function getControllerTags(target: Function): string[] | undefined {
  const bag = getMetadataBag(target);
  const tags = bag?.[openApiControllerTagsKey] as string[] | undefined;
  return tags ? [...tags] : undefined;
}

/**
 * Read OpenAPI metadata registered for a controller method.
 *
 * @param target Controller class token.
 * @param propertyKey Controller method key to inspect.
 * @returns A defensive metadata snapshot, or `undefined` when the method has no OpenAPI metadata.
 */
export function getMethodApiMetadata(target: Function, propertyKey: MetadataPropertyKey): MethodApiMetadata | undefined {
  const bag = getMetadataBag(target);

  const operationMap = bag?.[openApiMethodOperationKey] as Map<MetadataPropertyKey, ApiOperationMetadata> | undefined;
  const responsesMap = bag?.[openApiMethodResponsesKey] as Map<MetadataPropertyKey, ApiResponseMetadata[]> | undefined;
  const parametersMap = bag?.[openApiMethodParametersKey] as Map<MetadataPropertyKey, ApiParameterMetadata[]> | undefined;
  const requestBodyMap = bag?.[openApiMethodRequestBodyKey] as Map<MetadataPropertyKey, ApiBodyMetadata> | undefined;
  const securityMap = bag?.[openApiMethodSecurityKey] as Map<MetadataPropertyKey, string[]> | undefined;
  const securityRequirementsMap = bag?.[openApiMethodSecurityRequirementsKey] as
    | Map<MetadataPropertyKey, ApiSecurityRequirementMetadata[]>
    | undefined;
  const excludeEndpointMap = bag?.[openApiMethodExcludeEndpointKey] as Map<MetadataPropertyKey, boolean> | undefined;

  const operation = operationMap?.get(propertyKey);
  const responses = responsesMap?.get(propertyKey);
  const parameters = parametersMap?.get(propertyKey);
  const requestBody = requestBodyMap?.get(propertyKey);
  const security = securityMap?.get(propertyKey);
  const securityRequirements = securityRequirementsMap?.get(propertyKey);
  const excludeEndpoint = excludeEndpointMap?.get(propertyKey);

  if (!operation && !responses && !parameters && !requestBody && !security && !securityRequirements && !excludeEndpoint) {
    return undefined;
  }

  return {
    operation: cloneApiOperationMetadata(operation),
    responses: (responses ?? []).map((response) => cloneApiResponseMetadata(response)),
    parameters: parameters?.map((parameter) => cloneApiParameterMetadata(parameter)),
    requestBody: requestBody ? cloneApiBodyMetadata(requestBody) : undefined,
    security: security ? [...security] : undefined,
    securityRequirements: securityRequirements?.map((requirement) => cloneApiSecurityRequirementMetadata(requirement)),
    excludeEndpoint,
  };
}

type ClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type MethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;

/**
 * Attach an OpenAPI tag to a controller class.
 *
 * Multiple tags can be declared by stacking `@ApiTag(...)` decorators.
 *
 * @param tag Tag label appended to the controller-level tag list.
 * @returns A class decorator that stores controller tag metadata.
 */
export function ApiTag(tag: string): ClassDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    const existing = (bag[openApiControllerTagsKey] as string[] | undefined) ?? [];
    bag[openApiControllerTagsKey] = [...existing, tag];
  };
}

/**
 * Describe a controller method's OpenAPI operation metadata.
 *
 * @param options Operation metadata such as summary, description, and deprecation flag.
 * @returns A method decorator that stores operation metadata.
 */
export function ApiOperation(options: ApiOperationOptions): MethodDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let map = bag[openApiMethodOperationKey] as Map<MetadataPropertyKey, ApiOperationMetadata> | undefined;

    if (!map) {
      map = new Map();
      bag[openApiMethodOperationKey] = map;
    }

    map.set(context.name, {
      deprecated: options.deprecated,
      description: options.description,
      summary: options.summary,
    });
  };
}

/**
 * Exclude a controller method from generated OpenAPI `paths`.
 *
 * @returns A method decorator that marks the endpoint as excluded.
 */
export function ApiExcludeEndpoint(): MethodDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let map = bag[openApiMethodExcludeEndpointKey] as Map<MetadataPropertyKey, boolean> | undefined;

    if (!map) {
      map = new Map();
      bag[openApiMethodExcludeEndpointKey] = map;
    }

    map.set(context.name, true);
  };
}

/**
 * Add a security requirement to a controller method in the generated OpenAPI document.
 *
 * @param name Security scheme name (for example `bearerAuth`, `oauth2`, `apiKey`).
 * @param scopes Optional OAuth scopes associated with this security requirement.
 * @returns A method decorator that appends security metadata.
 */
export function ApiSecurity(name: string, scopes: string[] = []): MethodDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let securityMap = bag[openApiMethodSecurityKey] as Map<MetadataPropertyKey, string[]> | undefined;

    if (!securityMap) {
      securityMap = new Map();
      bag[openApiMethodSecurityKey] = securityMap;
    }

    const existingSecurityNames = securityMap.get(context.name) ?? [];

    if (!existingSecurityNames.includes(name)) {
      securityMap.set(context.name, [...existingSecurityNames, name]);
    }

    let requirementsMap = bag[openApiMethodSecurityRequirementsKey] as
      | Map<MetadataPropertyKey, ApiSecurityRequirementMetadata[]>
      | undefined;

    if (!requirementsMap) {
      requirementsMap = new Map();
      bag[openApiMethodSecurityRequirementsKey] = requirementsMap;
    }

    const existingRequirements = requirementsMap.get(context.name) ?? [];

    requirementsMap.set(context.name, [...existingRequirements, { [name]: [...scopes] }]);
  };
}

function registerMethodParameter(parameter: ApiParameterMetadata): MethodDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let map = bag[openApiMethodParametersKey] as Map<MetadataPropertyKey, ApiParameterMetadata[]> | undefined;

    if (!map) {
      map = new Map();
      bag[openApiMethodParametersKey] = map;
    }

    const existing = map.get(context.name) ?? [];

    map.set(context.name, [...existing, cloneApiParameterMetadata(parameter)]);
  };
}

/**
 * Declare a path parameter for a controller method.
 *
 * @param name Parameter name.
 * @param options Optional parameter metadata such as description, required, and schema.
 * @returns A method decorator that appends path-parameter metadata.
 */
export function ApiParam(name: string, options: ApiParameterOptions = {}): MethodDecoratorFn {
  return registerMethodParameter({
    description: options.description,
    in: 'path',
    name,
    required: options.required ?? true,
    schema: options.schema,
  });
}

/**
 * Declare a query parameter for a controller method.
 *
 * @param name Parameter name.
 * @param options Optional parameter metadata such as description, required, and schema.
 * @returns A method decorator that appends query-parameter metadata.
 */
export function ApiQuery(name: string, options: ApiParameterOptions = {}): MethodDecoratorFn {
  return registerMethodParameter({
    description: options.description,
    in: 'query',
    name,
    required: options.required,
    schema: options.schema,
  });
}

/**
 * Declare a header parameter for a controller method.
 *
 * @param name Parameter name.
 * @param options Optional parameter metadata such as description, required, and schema.
 * @returns A method decorator that appends header-parameter metadata.
 */
export function ApiHeader(name: string, options: ApiParameterOptions = {}): MethodDecoratorFn {
  return registerMethodParameter({
    description: options.description,
    in: 'header',
    name,
    required: options.required,
    schema: options.schema,
  });
}

/**
 * Declare a cookie parameter for a controller method.
 *
 * @param name Parameter name.
 * @param options Optional parameter metadata such as description, required, and schema.
 * @returns A method decorator that appends cookie-parameter metadata.
 */
export function ApiCookie(name: string, options: ApiParameterOptions = {}): MethodDecoratorFn {
  return registerMethodParameter({
    description: options.description,
    in: 'cookie',
    name,
    required: options.required,
    schema: options.schema,
  });
}

/**
 * Declare an explicit request body for a controller method.
 *
 * @param options Request-body metadata and schema/content declarations.
 * @returns A method decorator that stores request-body metadata.
 */
export function ApiBody(options: ApiBodyOptions): MethodDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let map = bag[openApiMethodRequestBodyKey] as Map<MetadataPropertyKey, ApiBodyMetadata> | undefined;

    if (!map) {
      map = new Map();
      bag[openApiMethodRequestBodyKey] = map;
    }

    map.set(context.name, cloneApiBodyMetadata(options));
  };
}

function normalizeApiResponseOptions(
  statusOrOptions: number | ApiResponseOptions,
  options?: Omit<ApiResponseOptions, 'status'>,
): ApiResponseOptions {
  if (typeof statusOrOptions === 'number') {
    return {
      status: statusOrOptions,
      ...options,
    };
  }

  return statusOrOptions;
}

/** Declare an expected HTTP response for a controller method. */
export function ApiResponse(status: number, options?: Omit<ApiResponseOptions, 'status'>): MethodDecoratorFn;
/** Declare an expected HTTP response for a controller method. */
export function ApiResponse(options: ApiResponseOptions): MethodDecoratorFn;
/**
 * Declare an expected HTTP response for a controller method.
 *
 * @param statusOrOptions Either a numeric status code or full response-options object.
 * @param options Optional response metadata when the first argument is numeric status.
 * @returns A method decorator that appends response metadata for the method.
 */
export function ApiResponse(
  statusOrOptions: number | ApiResponseOptions,
  options?: Omit<ApiResponseOptions, 'status'>,
): MethodDecoratorFn {
  const normalized = normalizeApiResponseOptions(statusOrOptions, options);

  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    let map = bag[openApiMethodResponsesKey] as Map<MetadataPropertyKey, ApiResponseMetadata[]> | undefined;

    if (!map) {
      map = new Map();
      bag[openApiMethodResponsesKey] = map;
    }

    const existing = map.get(context.name) ?? [];

    map.set(context.name, [
      ...existing,
      cloneApiResponseMetadata({
        description: normalized.description,
        schema: normalized.schema,
        status: normalized.status,
        type: normalized.type,
      }),
    ]);
  };
}

/**
 * Mark a controller method as requiring Bearer token authentication in the OpenAPI spec.
 *
 * @returns A method decorator equivalent to `ApiSecurity('bearerAuth')`.
 */
export function ApiBearerAuth(): MethodDecoratorFn {
  return ApiSecurity('bearerAuth');
}
