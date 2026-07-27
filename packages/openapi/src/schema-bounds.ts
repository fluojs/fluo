import type {
  OpenApiDocument,
  OpenApiMediaTypeObject,
  OpenApiOperationObject,
  OpenApiPathItemObject,
  OpenApiResponseObject,
  OpenApiSchemaObject,
} from './schema-builder.js';

function normalizeSchemaRecord(
  schemas: Record<string, OpenApiSchemaObject>,
  path: string,
): Record<string, OpenApiSchemaObject> {
  const normalized: Record<string, OpenApiSchemaObject> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    normalized[name] = normalizeOpenApiSchemaBounds(schema, `${path}.${name}`);
  }

  return normalized;
}

function normalizeSchemaList(
  schemas: readonly OpenApiSchemaObject[],
  path: string,
): OpenApiSchemaObject[] {
  return schemas.map((schema, index) => normalizeOpenApiSchemaBounds(schema, `${path}[${String(index)}]`));
}

function normalizeOpenApiSchemaBounds(schema: OpenApiSchemaObject, path: string): OpenApiSchemaObject {
  const normalized: OpenApiSchemaObject = { ...schema };

  if (typeof schema.exclusiveMinimum === 'number' && !Number.isFinite(schema.exclusiveMinimum)) {
    throw new TypeError(`OpenAPI schema ${path}.exclusiveMinimum must be a finite number.`);
  }

  if (typeof schema.exclusiveMinimum === 'boolean') {
    delete normalized.exclusiveMinimum;

    if (schema.exclusiveMinimum) {
      if (schema.minimum === undefined || !Number.isFinite(schema.minimum)) {
        throw new TypeError(`OpenAPI schema ${path}.exclusiveMinimum requires a finite minimum.`);
      }

      normalized.exclusiveMinimum = schema.minimum;
      delete normalized.minimum;
    }
  }

  if (typeof schema.exclusiveMaximum === 'number' && !Number.isFinite(schema.exclusiveMaximum)) {
    throw new TypeError(`OpenAPI schema ${path}.exclusiveMaximum must be a finite number.`);
  }

  if (typeof schema.exclusiveMaximum === 'boolean') {
    delete normalized.exclusiveMaximum;

    if (schema.exclusiveMaximum) {
      if (schema.maximum === undefined || !Number.isFinite(schema.maximum)) {
        throw new TypeError(`OpenAPI schema ${path}.exclusiveMaximum requires a finite maximum.`);
      }

      normalized.exclusiveMaximum = schema.maximum;
      delete normalized.maximum;
    }
  }

  if (schema.allOf) {
    normalized.allOf = normalizeSchemaList(schema.allOf, `${path}.allOf`);
  }

  if (schema.oneOf) {
    normalized.oneOf = normalizeSchemaList(schema.oneOf, `${path}.oneOf`);
  }

  if (schema.anyOf) {
    normalized.anyOf = normalizeSchemaList(schema.anyOf, `${path}.anyOf`);
  }

  if (schema.not) {
    normalized.not = normalizeOpenApiSchemaBounds(schema.not, `${path}.not`);
  }

  if (schema.properties) {
    normalized.properties = normalizeSchemaRecord(schema.properties, `${path}.properties`);
  }

  if (schema.items) {
    normalized.items = normalizeOpenApiSchemaBounds(schema.items, `${path}.items`);
  }

  if (typeof schema.additionalProperties === 'object') {
    normalized.additionalProperties = normalizeOpenApiSchemaBounds(
      schema.additionalProperties,
      `${path}.additionalProperties`,
    );
  }

  return normalized;
}

function normalizeContent(
  content: Record<string, OpenApiMediaTypeObject>,
  path: string,
): Record<string, OpenApiMediaTypeObject> {
  const normalized: Record<string, OpenApiMediaTypeObject> = {};

  for (const [mediaType, media] of Object.entries(content)) {
    normalized[mediaType] = {
      ...media,
      schema: normalizeOpenApiSchemaBounds(media.schema, `${path}.${mediaType}.schema`),
    };
  }

  return normalized;
}

function normalizeResponses(
  responses: Record<string, OpenApiResponseObject>,
  path: string,
): Record<string, OpenApiResponseObject> {
  const normalized: Record<string, OpenApiResponseObject> = {};

  for (const [status, response] of Object.entries(responses)) {
    normalized[status] = {
      ...response,
      ...(response.content ? { content: normalizeContent(response.content, `${path}.${status}.content`) } : {}),
    };
  }

  return normalized;
}

function normalizeOperation(operation: OpenApiOperationObject, path: string): OpenApiOperationObject {
  return {
    ...operation,
    ...(operation.parameters
      ? {
          parameters: operation.parameters.map((parameter, index) => ({
            ...parameter,
            schema: normalizeOpenApiSchemaBounds(parameter.schema, `${path}.parameters[${String(index)}].schema`),
          })),
        }
      : {}),
    ...(operation.requestBody
      ? {
          requestBody: {
            ...operation.requestBody,
            content: normalizeContent(operation.requestBody.content, `${path}.requestBody.content`),
          },
        }
      : {}),
    responses: normalizeResponses(operation.responses, `${path}.responses`),
  };
}

function normalizePaths(paths: Record<string, OpenApiPathItemObject>): Record<string, OpenApiPathItemObject> {
  const normalizedPaths: Record<string, OpenApiPathItemObject> = {};

  for (const [path, pathItem] of Object.entries(paths)) {
    const normalizedPathItem: OpenApiPathItemObject = {};

    for (const [method, operation] of Object.entries(pathItem)) {
      normalizedPathItem[method] = operation ? normalizeOperation(operation, `paths.${path}.${method}`) : undefined;
    }

    normalizedPaths[path] = normalizedPathItem;
  }

  return normalizedPaths;
}

/**
 * Normalize legacy boolean exclusive-bound metadata before an OpenAPI 3.1 document is exposed.
 *
 * @param document Generated document, including any final caller transform.
 * @returns A detached document whose exclusive bounds use OpenAPI 3.1 numeric keywords.
 */
export function normalizeOpenApiDocumentSchemaBounds(document: OpenApiDocument): OpenApiDocument {
  return {
    ...document,
    ...(document.components
      ? {
          components: {
            ...document.components,
            ...(document.components.schemas
              ? { schemas: normalizeSchemaRecord(document.components.schemas, 'components.schemas') }
              : {}),
          },
        }
      : {}),
    paths: normalizePaths(document.paths),
  };
}
