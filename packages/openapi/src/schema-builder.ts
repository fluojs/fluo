import type { HandlerDescriptor, HttpMethod } from '@konekti/http';

type OpenApiOperationMethod = Lowercase<HttpMethod>;

export interface OpenApiInfoObject {
  title: string;
  version: string;
}

export interface OpenApiResponseObject {
  description: string;
}

export interface OpenApiOperationObject {
  operationId: string;
  tags: string[];
  responses: Record<string, OpenApiResponseObject>;
}

export interface OpenApiPathItemObject {
  [method: string]: OpenApiOperationObject | undefined;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfoObject;
  paths: Record<string, OpenApiPathItemObject>;
}

export interface BuildOpenApiDocumentOptions {
  descriptors: readonly HandlerDescriptor[];
  title: string;
  version: string;
}

function normalizeControllerTag(descriptor: HandlerDescriptor): string {
  return descriptor.controllerToken.name || 'Controller';
}

function normalizeOperationId(descriptor: HandlerDescriptor): string {
  const controller = normalizeControllerTag(descriptor);
  const path = descriptor.route.path.replaceAll('/', '_').replaceAll(':', '').replaceAll('-', '_');

  return `${controller}_${descriptor.methodName}_${descriptor.route.method.toLowerCase()}${path}`;
}

export function buildOpenApiDocument(options: BuildOpenApiDocumentOptions): OpenApiDocument {
  const paths: Record<string, OpenApiPathItemObject> = {};

  for (const descriptor of options.descriptors) {
    const path = descriptor.route.path;
    const method = descriptor.route.method.toLowerCase() as OpenApiOperationMethod;
    const pathItem = paths[path] ?? {};

    pathItem[method] = {
      operationId: normalizeOperationId(descriptor),
      responses: {
        '200': {
          description: 'OK',
        },
      },
      tags: [normalizeControllerTag(descriptor)],
    };

    paths[path] = pathItem;
  }

  return {
    info: {
      title: options.title,
      version: options.version,
    },
    openapi: '3.1.0',
    paths,
  };
}
