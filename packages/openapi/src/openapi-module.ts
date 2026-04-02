import {
  Controller,
  Get,
  NotFoundException,
  createHandlerMapping,
  type HandlerDescriptor,
  type HandlerSource,
  type RequestContext,
} from '@konekti/http';
import { Inject, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@konekti/core';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { OpenApiHandlerRegistry } from './handler-registry.js';
import {
  buildOpenApiDocument,
  type DefaultErrorResponsesPolicy,
  type OpenApiDocument,
  type OpenApiSecuritySchemeObject,
} from './schema-builder.js';

const SWAGGER_UI_CSS_URL = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';
const SWAGGER_UI_BUNDLE_JS_URL = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';

export interface OpenApiModuleOptions {
  defaultErrorResponsesPolicy?: DefaultErrorResponsesPolicy;
  title: string;
  version: string;
  ui?: boolean;
  descriptors?: readonly HandlerDescriptor[];
  sources?: readonly HandlerSource[];
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  extraModels?: Constructor[];
  documentTransform?: (document: OpenApiDocument) => OpenApiDocument;
}

type OpenApiOptionsProvider =
  | {
      scope: 'singleton';
      useValue: OpenApiModuleOptions;
    }
  | {
      inject?: Token[];
      scope: 'singleton';
      useFactory: (...deps: unknown[]) => MaybePromise<OpenApiModuleOptions>;
    };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function createSwaggerUiHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CSS_URL}" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_BUNDLE_JS_URL}" crossorigin></script>
    <script>
      const specUrl = window.location.pathname.replace(/\/docs\/?$/, '/openapi.json');
      window.ui = SwaggerUIBundle({
        url: specUrl,
        dom_id: '#swagger-ui'
      });
    </script>
  </body>
</html>`;
}

function isOpenApiModuleOptions(value: unknown): value is OpenApiModuleOptions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const options = value as Record<string, unknown>;

  return typeof options.title === 'string' && typeof options.version === 'string';
}

function resolveOpenApiDescriptors(options: OpenApiModuleOptions): readonly HandlerDescriptor[] {
  const sourceDescriptors = createHandlerMapping([...(options.sources ?? [])]).descriptors;
  const explicitDescriptors = [...(options.descriptors ?? [])];

  if (sourceDescriptors.length === 0) {
    return explicitDescriptors;
  }

  if (explicitDescriptors.length === 0) {
    return sourceDescriptors;
  }

  return [...sourceDescriptors, ...explicitDescriptors];
}

export class OpenApiModule {
  static forRoot(options: OpenApiModuleOptions): ModuleType {
    return this.createModule({
      scope: 'singleton',
      useValue: options,
    });
  }

  static forRootAsync(options: AsyncModuleOptions<OpenApiModuleOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      scope: 'singleton',
      useFactory: options.useFactory,
    });
  }

  private static createModule(optionsProvider: OpenApiOptionsProvider): ModuleType {
    const openApiModuleOptionsToken = Symbol('konekti.openapi.module-options');
    const openApiDocumentToken = Symbol('konekti.openapi.document');

    @Controller('')
    @Inject([openApiDocumentToken, openApiModuleOptionsToken])
    class OpenApiController {
      constructor(
        private readonly document: OpenApiDocument,
        private readonly options: OpenApiModuleOptions,
      ) {}

      @Get('/openapi.json')
      getDocument() {
        return this.document;
      }

      @Get('/docs')
      getSwaggerUi(_input: undefined, context: RequestContext): string {
        if (!(this.options.ui ?? false)) {
          throw new NotFoundException('Swagger UI is disabled.');
        }

        context.response.setHeader('content-type', 'text/html; charset=utf-8');

        return createSwaggerUiHtml(this.options.title);
      }
    }

    class OpenApiRuntimeModule {}

    defineModule(OpenApiRuntimeModule, {
      controllers: [OpenApiController],
      providers: [
        {
          ...optionsProvider,
          provide: openApiModuleOptionsToken,
        },
        {
          inject: [openApiModuleOptionsToken],
          provide: openApiDocumentToken,
          scope: 'singleton',
          useFactory: (...deps: unknown[]): OpenApiDocument => {
            const [options] = deps;

            if (!isOpenApiModuleOptions(options)) {
              throw new Error('OpenApiModule options provider must resolve title and version.');
            }

            const registry = new OpenApiHandlerRegistry();

            registry.setDescriptors(resolveOpenApiDescriptors(options));

            return buildOpenApiDocument({
              documentTransform: options.documentTransform,
              defaultErrorResponsesPolicy: options.defaultErrorResponsesPolicy,
              descriptors: registry.getDescriptors(),
              extraModels: options.extraModels,
              securitySchemes: options.securitySchemes,
              title: options.title,
              version: options.version,
            });
          },
        },
      ],
    });

    return OpenApiRuntimeModule;
  }
}
