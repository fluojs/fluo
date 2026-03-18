import {
  Controller,
  Get,
  NotFoundException,
  createHandlerMapping,
  type HandlerDescriptor,
  type HandlerSource,
  type RequestContext,
} from '@konekti/http';
import { Inject, type AsyncModuleOptions, type MaybePromise, type Token } from '@konekti/core';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { OpenApiHandlerRegistry } from './handler-registry.js';
import { buildOpenApiDocument, type OpenApiDocument } from './schema-builder.js';

export interface OpenApiModuleOptions {
  title: string;
  version: string;
  ui?: boolean;
  descriptors?: readonly HandlerDescriptor[];
  sources?: readonly HandlerSource[];
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

function createSwaggerUiHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
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

            if (options.descriptors && options.sources) {
              throw new Error('OpenApiModule.forRoot() accepts either descriptors or sources, but not both.');
            }

            const registry = new OpenApiHandlerRegistry();

            registry.setDescriptors(options.descriptors ?? createHandlerMapping([...(options.sources ?? [])]).descriptors);

            return buildOpenApiDocument({
              descriptors: registry.getDescriptors(),
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
