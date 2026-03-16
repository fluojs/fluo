import { Controller, Get, NotFoundException, type HandlerDescriptor, type RequestContext } from '@konekti/http';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { OpenApiHandlerRegistry } from './handler-registry.js';
import { buildOpenApiDocument } from './schema-builder.js';

export interface OpenApiModuleOptions {
  title: string;
  version: string;
  ui?: boolean;
  descriptors?: readonly HandlerDescriptor[];
}

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

export class OpenApiModule {
  static forRoot(options: OpenApiModuleOptions): ModuleType {
    const uiEnabled = options.ui ?? false;

    const registry = new OpenApiHandlerRegistry();
    registry.setDescriptors(options.descriptors ?? []);

    const document = buildOpenApiDocument({
      descriptors: registry.getDescriptors(),
      title: options.title,
      version: options.version,
    });

    @Controller('')
    class OpenApiController {
      @Get('/openapi.json')
      getDocument() {
        return document;
      }

      @Get('/docs')
      getSwaggerUi(_input: undefined, context: RequestContext): string {
        if (!uiEnabled) {
          throw new NotFoundException('Swagger UI is disabled.');
        }

        context.response.setHeader('content-type', 'text/html; charset=utf-8');

        return createSwaggerUiHtml(options.title);
      }
    }

    class OpenApiRuntimeModule {}

    defineModule(OpenApiRuntimeModule, {
      controllers: [OpenApiController],
    });

    return OpenApiRuntimeModule;
  }
}
