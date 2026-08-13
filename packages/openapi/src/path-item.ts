import type { OpenApiOperationObject, OpenApiParameterObject } from './schema-builder.js';

/** Standard OpenAPI 3.1 operation keys accepted on a Path Item Object. */
export type OpenApiOperationMethod = 'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put' | 'trace';

interface OpenApiReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

interface OpenApiServerObject {
  url: string;
  description?: string;
  variables?: Record<string, {
    default: string;
    description?: string;
    enum?: string[];
  }>;
}

/**
 * OpenAPI Path Item Object containing standard operations, fixed fields, and specification extensions.
 */
export interface OpenApiPathItemObject {
  $ref?: string;
  summary?: string;
  description?: string;
  servers?: OpenApiServerObject[];
  parameters?: (OpenApiParameterObject | OpenApiReferenceObject)[];
  delete?: OpenApiOperationObject;
  get?: OpenApiOperationObject;
  head?: OpenApiOperationObject;
  options?: OpenApiOperationObject;
  patch?: OpenApiOperationObject;
  post?: OpenApiOperationObject;
  put?: OpenApiOperationObject;
  trace?: OpenApiOperationObject;
  [extension: `x-${string}`]: unknown;
}

const OPENAPI_PATH_ITEM_FIXED_FIELDS: ReadonlySet<string> = new Set([
  '$ref',
  'description',
  'parameters',
  'servers',
  'summary',
]);

const DESCRIPTOR_OPERATION_METHODS: ReadonlyMap<string, OpenApiOperationMethod> = new Map([
  ['DELETE', 'delete'],
  ['GET', 'get'],
  ['HEAD', 'head'],
  ['OPTIONS', 'options'],
  ['PATCH', 'patch'],
  ['POST', 'post'],
  ['PUT', 'put'],
]);

const OPENAPI_OPERATION_METHODS: ReadonlySet<string> = new Set<OpenApiOperationMethod>([
  ...DESCRIPTOR_OPERATION_METHODS.values(),
  'trace',
]);

/**
 * Resolve one Fluo descriptor method to its standard OpenAPI operation key.
 *
 * @param method Descriptor method supplied by HTTP route metadata.
 * @param path OpenAPI path used to identify invalid descriptor input.
 * @returns The corresponding standard OpenAPI operation key.
 * @throws {TypeError} When Fluo cannot author the descriptor method as an OpenAPI operation.
 */
export function resolveDescriptorOperationMethod(method: string, path: string): OpenApiOperationMethod {
  const operationMethod = DESCRIPTOR_OPERATION_METHODS.get(method);
  if (operationMethod !== undefined) {
    return operationMethod;
  }

  throw new TypeError(`OpenAPI cannot document unsupported HTTP method "${method}" for path "${path}".`);
}

/**
 * Determine whether a Path Item key is a standard OpenAPI 3.1 operation.
 *
 * @param key Path Item key to inspect.
 * @returns Whether the key is a standard operation key.
 */
export function isOpenApiOperationMethod(key: string): key is OpenApiOperationMethod {
  return OPENAPI_OPERATION_METHODS.has(key);
}

/**
 * Validate every transformed Path Item against the OpenAPI 3.1 key policy.
 *
 * @param paths Final document paths after any caller transform.
 * @returns Nothing when every Path Item key is valid.
 * @throws {TypeError} When a Path Item contains an unknown non-extension key.
 */
export function validateOpenApiPathItemKeys(paths: Readonly<Record<string, object>>): void {
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const key of Object.keys(pathItem)) {
      if (isOpenApiOperationMethod(key) || OPENAPI_PATH_ITEM_FIXED_FIELDS.has(key) || key.startsWith('x-')) {
        continue;
      }

      throw new TypeError(`OpenAPI Path Item for path "${path}" contains unsupported key "${key}".`);
    }
  }
}
