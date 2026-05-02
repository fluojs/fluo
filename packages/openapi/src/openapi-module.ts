import {
  Controller,
  Get,
  NotFoundException,
  createHandlerMapping,
  type HandlerDescriptor,
  type HandlerSource,
  type RequestContext,
} from '@fluojs/http';
import { Inject, type AsyncModuleOptions, type Constructor, type MaybePromise, type Token } from '@fluojs/core';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { OpenApiHandlerRegistry } from './handler-registry.js';
import {
  buildOpenApiDocument,
  type DefaultErrorResponsesPolicy,
  type OpenApiDocument,
  type OpenApiSecuritySchemeObject,
} from './schema-builder.js';

const SWAGGER_UI_DIST_VERSION = '5.32.2';
const SWAGGER_UI_DIST_BASE_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}`;
const SWAGGER_UI_CSS_URL = `${SWAGGER_UI_DIST_BASE_URL}/swagger-ui.css`;
const SWAGGER_UI_BUNDLE_JS_URL = `${SWAGGER_UI_DIST_BASE_URL}/swagger-ui-bundle.js`;

/**
 * Asset URLs used by the generated Swagger UI HTML page.
 */
export interface OpenApiSwaggerUiAssetsOptions {
  cssUrl?: string;
  jsBundleUrl?: string;
}

/**
 * Public options for `OpenApiModule.forRoot(...)` and `OpenApiModule.forRootAsync(...)`.
 *
 * @remarks
 * Keep README examples for full controller/module workflows. These options are
 * intended to document the runtime hooks that shape the generated document.
 */
export interface OpenApiModuleOptions {
  defaultErrorResponsesPolicy?: DefaultErrorResponsesPolicy;
  title: string;
  version: string;
  ui?: boolean;
  descriptors?: readonly HandlerDescriptor[];
  sources?: readonly HandlerSource[];
  securitySchemes?: Record<string, OpenApiSecuritySchemeObject>;
  swaggerUiAssets?: OpenApiSwaggerUiAssetsOptions;
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

function cloneRecord<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!record) {
    return undefined;
  }

  const clone: Record<string, T> = {};

  for (const [key, value] of Object.entries(record)) {
    clone[key] = cloneSnapshotValue(value);
  }

  return clone;
}

function cloneSnapshotValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => cloneSnapshotValue(entry)) as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const clone: Record<PropertyKey, unknown> = {};

  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneSnapshotValue((value as Record<PropertyKey, unknown>)[key]);
  }

  return clone as T;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }

  return Object.freeze(value);
}

function snapshotOpenApiModuleOptions(options: OpenApiModuleOptions): OpenApiModuleOptions {
  return deepFreeze({
    defaultErrorResponsesPolicy: options.defaultErrorResponsesPolicy,
    descriptors: options.descriptors ? cloneSnapshotValue(options.descriptors) : undefined,
    documentTransform: options.documentTransform,
    extraModels: options.extraModels ? [...options.extraModels] : undefined,
    securitySchemes: cloneRecord(options.securitySchemes),
    sources: options.sources ? cloneSnapshotValue(options.sources) : undefined,
    swaggerUiAssets: options.swaggerUiAssets ? { ...options.swaggerUiAssets } : undefined,
    title: options.title,
    ui: options.ui,
    version: options.version,
  });
}

function resolveSwaggerUiAssets(options: OpenApiModuleOptions): Required<OpenApiSwaggerUiAssetsOptions> {
  return {
    cssUrl: options.swaggerUiAssets?.cssUrl ?? SWAGGER_UI_CSS_URL,
    jsBundleUrl: options.swaggerUiAssets?.jsBundleUrl ?? SWAGGER_UI_BUNDLE_JS_URL,
  };
}

function createSwaggerUiHtml(title: string, assets: Required<OpenApiSwaggerUiAssetsOptions>): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${escapeHtml(assets.cssUrl)}" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${escapeHtml(assets.jsBundleUrl)}" crossorigin></script>
    <script>
      const specUrl = window.location.pathname.replace(/\/docs\/?$/, '/openapi.json');
      const swaggerUi = SwaggerUIBundle({
        url: specUrl,
        dom_id: '#swagger-ui'
      });
      void swaggerUi;
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

/**
 * Runtime module entrypoint for serving OpenAPI JSON and optional Swagger UI.
 */
export class OpenApiModule {
  /**
   * Registers OpenAPI providers using static options.
   *
   * @param options Static module options used to build and serve the OpenAPI document.
   * @returns A runtime module type that can be imported in `@Module({ imports: [...] })`.
   *
   * @example
   * ```ts
   * OpenApiModule.forRoot({
   *   title: 'Public API',
   *   version: '1.0.0',
   *   ui: true,
   * });
   * ```
   */
  static forRoot(options: OpenApiModuleOptions): ModuleType {
    return this.createModule({
      scope: 'singleton',
      useValue: snapshotOpenApiModuleOptions(options),
    });
  }

  /**
   * Registers OpenAPI providers using an async DI factory.
   *
   * @param options Async options factory plus optional DI `inject` token list.
   * @returns A runtime module type that resolves options at bootstrap time.
   *
   * @example
   * ```ts
   * OpenApiModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config) => ({
   *     title: config.get('APP_NAME'),
   *     version: config.get('APP_VERSION'),
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: AsyncModuleOptions<OpenApiModuleOptions>): ModuleType {
    return this.createModule({
      inject: options.inject,
      scope: 'singleton',
      useFactory: async (...deps: unknown[]) => snapshotOpenApiModuleOptions(await options.useFactory(...deps)),
    });
  }

  private static createModule(optionsProvider: OpenApiOptionsProvider): ModuleType {
    const openApiModuleOptionsToken = Symbol('fluo.openapi.module-options');
    const openApiDocumentToken = Symbol('fluo.openapi.document');

    @Controller('')
    @Inject(openApiDocumentToken, openApiModuleOptionsToken)
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

        return createSwaggerUiHtml(this.options.title, resolveSwaggerUiAssets(this.options));
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
