import { metadataSymbol, type Constructor, type MetadataPropertyKey } from '@konekti/core';

export interface ApiOperationOptions {
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ApiResponseOptions {
  status: number;
  description?: string;
  schema?: Record<string, unknown>;
  type?: Constructor;
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
  schema?: Record<string, unknown>;
  type?: Constructor;
}

export interface MethodApiMetadata {
  operation?: ApiOperationMetadata;
  responses: ApiResponseMetadata[];
  security?: string[];
  securityRequirements?: ApiSecurityRequirementMetadata[];
  excludeEndpoint?: boolean;
}

const openApiControllerTagsKey = Symbol.for('konekti.openapi.controller-tags');
const openApiMethodOperationKey = Symbol.for('konekti.openapi.method-operation');
const openApiMethodResponsesKey = Symbol.for('konekti.openapi.method-responses');
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

/** Read tags registered via `@ApiTag` on a controller class. */
export function getControllerTags(target: Function): string[] | undefined {
  const bag = getMetadataBag(target);
  const tags = bag?.[openApiControllerTagsKey] as string[] | undefined;
  return tags ? [...tags] : undefined;
}

/** Read combined operation, response, and security metadata for a controller method. */
export function getMethodApiMetadata(target: Function, propertyKey: MetadataPropertyKey): MethodApiMetadata | undefined {
  const bag = getMetadataBag(target);

  const operationMap = bag?.[openApiMethodOperationKey] as Map<MetadataPropertyKey, ApiOperationMetadata> | undefined;
  const responsesMap = bag?.[openApiMethodResponsesKey] as Map<MetadataPropertyKey, ApiResponseMetadata[]> | undefined;
  const securityMap = bag?.[openApiMethodSecurityKey] as Map<MetadataPropertyKey, string[]> | undefined;
  const securityRequirementsMap = bag?.[openApiMethodSecurityRequirementsKey] as
    | Map<MetadataPropertyKey, ApiSecurityRequirementMetadata[]>
    | undefined;
  const excludeEndpointMap = bag?.[openApiMethodExcludeEndpointKey] as Map<MetadataPropertyKey, boolean> | undefined;

  const operation = operationMap?.get(propertyKey);
  const responses = responsesMap?.get(propertyKey);
  const security = securityMap?.get(propertyKey);
  const securityRequirements = securityRequirementsMap?.get(propertyKey);
  const excludeEndpoint = excludeEndpointMap?.get(propertyKey);

  if (!operation && !responses && !security && !securityRequirements && !excludeEndpoint) {
    return undefined;
  }

  return {
    operation: cloneApiOperationMetadata(operation),
    responses: (responses ?? []).map((response) => cloneApiResponseMetadata(response)),
    security: security ? [...security] : undefined,
    securityRequirements: securityRequirements?.map((requirement) => cloneApiSecurityRequirementMetadata(requirement)),
    excludeEndpoint,
  };
}

type ClassDecoratorFn = (value: Function, context: ClassDecoratorContext) => void;
type MethodDecoratorFn = (value: Function, context: ClassMethodDecoratorContext) => void;

/** Attach one or more OpenAPI tags to a controller class. */
export function ApiTag(tag: string): ClassDecoratorFn {
  return (_value, context) => {
    const bag = context.metadata as MetadataBag;
    const existing = (bag[openApiControllerTagsKey] as string[] | undefined) ?? [];
    bag[openApiControllerTagsKey] = [...existing, tag];
  };
}

/** Describe a controller method's OpenAPI operation (summary / description). */
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
/** Declare an expected HTTP response for a controller method. */
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

/** Mark a controller method as requiring Bearer token authentication in the OpenAPI spec. */
export function ApiBearerAuth(): MethodDecoratorFn {
  return ApiSecurity('bearerAuth');
}
