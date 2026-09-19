import { isOpenApiOperationMethod } from './path-item.js';
import type {
  OpenApiDocument,
  OpenApiMediaTypeObject,
  OpenApiOperationObject,
  OpenApiPathItemObject,
  OpenApiResponseObject,
  OpenApiSchemaObject,
} from './schema-builder.js';

type NormalizedSchemaCache = WeakMap<OpenApiSchemaObject, OpenApiSchemaObject>;

function normalizeSchemaRecord(
  schemas: Record<string, OpenApiSchemaObject>,
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): Record<string, OpenApiSchemaObject> {
  const normalized: Record<string, OpenApiSchemaObject> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    normalized[name] = normalizeOpenApiSchemaBounds(schema, `${path}.${name}`, normalizedSchemas);
  }

  return normalized;
}

function normalizeSchemaList(
  schemas: readonly OpenApiSchemaObject[],
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): OpenApiSchemaObject[] {
  return schemas.map((schema, index) => normalizeOpenApiSchemaBounds(
    schema,
    `${path}[${String(index)}]`,
    normalizedSchemas,
  ));
}

function normalizeOpenApiSchemaBounds(
  schema: OpenApiSchemaObject,
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): OpenApiSchemaObject {
  const cachedSchema = normalizedSchemas.get(schema);

  if (cachedSchema) {
    return cachedSchema;
  }

  const untypedSchema = schema as Record<string, unknown>;

  if ('nullable' in untypedSchema) {
    throw new TypeError(`OpenAPI schema ${path} has legacy nullable input; use a null type union or anyOf.`);
  }

  if (typeof untypedSchema.exclusiveMinimum === 'boolean') {
    throw new TypeError(`OpenAPI schema ${path} has boolean exclusiveMinimum; use a finite number.`);
  }

  if (typeof untypedSchema.exclusiveMaximum === 'boolean') {
    throw new TypeError(`OpenAPI schema ${path} has boolean exclusiveMaximum; use a finite number.`);
  }

  const normalized: OpenApiSchemaObject = { ...schema };
  normalizedSchemas.set(schema, normalized);

  if (typeof schema.exclusiveMinimum === 'number' && !Number.isFinite(schema.exclusiveMinimum)) {
    throw new TypeError(`OpenAPI schema ${path}.exclusiveMinimum must be a finite number.`);
  }

  if (typeof schema.exclusiveMaximum === 'number' && !Number.isFinite(schema.exclusiveMaximum)) {
    throw new TypeError(`OpenAPI schema ${path}.exclusiveMaximum must be a finite number.`);
  }


  if (schema.allOf) {
    normalized.allOf = normalizeSchemaList(schema.allOf, `${path}.allOf`, normalizedSchemas);
  }

  if (schema.oneOf) {
    normalized.oneOf = normalizeSchemaList(schema.oneOf, `${path}.oneOf`, normalizedSchemas);
  }

  if (schema.anyOf) {
    normalized.anyOf = normalizeSchemaList(schema.anyOf, `${path}.anyOf`, normalizedSchemas);
  }

  if (schema.not) {
    normalized.not = normalizeOpenApiSchemaBounds(schema.not, `${path}.not`, normalizedSchemas);
  }

  if (schema.properties) {
    normalized.properties = normalizeSchemaRecord(schema.properties, `${path}.properties`, normalizedSchemas);
  }

  if (schema.items) {
    normalized.items = normalizeOpenApiSchemaBounds(schema.items, `${path}.items`, normalizedSchemas);
  }

  if (typeof schema.additionalProperties === 'object') {
    normalized.additionalProperties = normalizeOpenApiSchemaBounds(
      schema.additionalProperties,
      `${path}.additionalProperties`,
      normalizedSchemas,
    );
  }

  return normalized;
}

function normalizeContent(
  content: Record<string, OpenApiMediaTypeObject>,
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): Record<string, OpenApiMediaTypeObject> {
  const normalized: Record<string, OpenApiMediaTypeObject> = {};

  for (const [mediaType, media] of Object.entries(content)) {
    normalized[mediaType] = {
      ...media,
      schema: normalizeOpenApiSchemaBounds(media.schema, `${path}.${mediaType}.schema`, normalizedSchemas),
    };
  }

  return normalized;
}

function normalizeResponses(
  responses: Record<string, OpenApiResponseObject>,
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): Record<string, OpenApiResponseObject> {
  const normalized: Record<string, OpenApiResponseObject> = {};

  for (const [status, response] of Object.entries(responses)) {
    normalized[status] = {
      ...response,
      ...(response.content
        ? { content: normalizeContent(response.content, `${path}.${status}.content`, normalizedSchemas) }
        : {}),
    };
  }

  return normalized;
}

function normalizeOperation(
  operation: OpenApiOperationObject,
  path: string,
  normalizedSchemas: NormalizedSchemaCache,
): OpenApiOperationObject {
  return {
    ...operation,
    ...(operation.parameters
      ? {
          parameters: operation.parameters.map((parameter, index) => ({
            ...parameter,
            schema: normalizeOpenApiSchemaBounds(
              parameter.schema,
              `${path}.parameters[${String(index)}].schema`,
              normalizedSchemas,
            ),
          })),
        }
      : {}),
    ...(operation.requestBody
      ? {
          requestBody: {
            ...operation.requestBody,
            content: normalizeContent(operation.requestBody.content, `${path}.requestBody.content`, normalizedSchemas),
          },
        }
      : {}),
    responses: normalizeResponses(operation.responses, `${path}.responses`, normalizedSchemas),
  };
}

function normalizePaths(
  paths: Record<string, OpenApiPathItemObject>,
  normalizedSchemas: NormalizedSchemaCache,
): Record<string, OpenApiPathItemObject> {
  const normalizedPaths: Record<string, OpenApiPathItemObject> = {};

  for (const [path, pathItem] of Object.entries(paths)) {
    const normalizedPathItem: OpenApiPathItemObject = {};

    if (pathItem.parameters) {
      normalizedPathItem.parameters = pathItem.parameters.map((parameter, index) => (
        'schema' in parameter
          ? {
              ...parameter,
              schema: normalizeOpenApiSchemaBounds(
                parameter.schema,
                `paths.${path}.parameters[${String(index)}].schema`,
                normalizedSchemas,
              ),
            }
          : { ...parameter }
      ));
    }

    for (const [key, value] of Object.entries(pathItem)) {
      if (key === 'parameters') {
        continue;
      }

      if (isOpenApiOperationMethod(key)) {
        normalizedPathItem[key] = value
          ? normalizeOperation(value, `paths.${path}.${key}`, normalizedSchemas)
          : undefined;
        continue;
      }

      Reflect.set(normalizedPathItem, key, value);
    }

    normalizedPaths[path] = normalizedPathItem;
  }

  return normalizedPaths;
}

/**
 * Validate OpenAPI 3.1 schema bounds before a document is exposed.
 *
 * @param document Generated document, including any final caller transform.
 * @returns A detached document whose schema keywords use OpenAPI 3.1 forms.
 */
export function normalizeOpenApiDocumentSchemaBounds(document: OpenApiDocument): OpenApiDocument {
  const normalizedSchemas: NormalizedSchemaCache = new WeakMap();

  return {
    ...document,
    ...(document.components
      ? {
          components: {
            ...document.components,
            ...(document.components.schemas
              ? { schemas: normalizeSchemaRecord(document.components.schemas, 'components.schemas', normalizedSchemas) }
              : {}),
          },
        }
      : {}),
    paths: normalizePaths(document.paths, normalizedSchemas),
  };
}
