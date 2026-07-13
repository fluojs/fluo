import { type AsyncModuleOptions, type Constructor, Inject, type InjectionToken, type MaybePromise } from '@fluojs/core';
import {
  Controller,
  createHandlerMapping,
  Get,
  type HandlerDescriptor,
  type HandlerSource,
  NotFoundException,
  type RequestContext,
} from '@fluojs/http';
import { defineModule, type ModuleType } from '@fluojs/runtime';

import { OpenApiHandlerRegistry } from './handler-registry.js';
import {
  buildOpenApiDocument,
  type DefaultErrorResponsesPolicy,
  type OpenApiDocument,
  type OpenApiSecuritySchemeObject,
} from './schema-builder.js';
import { cloneSnapshotValue, createFrozenSnapshot } from './snapshot.js';
import {
  createSwaggerUiHtml,
  type OpenApiSwaggerUiAssetsOptions,
  resolveSwaggerUiAssets,
} from './swagger-ui.js';

const DEFAULT_DOCUMENT_PATH = '/openapi.json';
const DEFAULT_UI_PATH = '/docs';

export type { OpenApiSwaggerUiAssetsOptions } from './swagger-ui.js';

/**
 * Routes owned by one `OpenApiModule` registration.
 *
 * @remarks
 * Paths use the normal `@fluojs/http` route grammar and are normalized before
 * registration. The defaults remain `/openapi.json` and `/docs`.
 */
export interface OpenApiRouteOptions {
  /** JSON document route. Defaults to `/openapi.json`. */
  readonly documentPath?: string;
  /** Swagger UI route. Defaults to `/docs`. */
  readonly uiPath?: string;
}

/**
 * Public document and route options for `OpenApiModule.forRoot(...)`.
 *
 * @remarks
 * Keep README examples for full controller/module workflows. These options are
 * intended to document the runtime hooks that shape the generated document.
 */
export interface OpenApiModuleOptions extends OpenApiRouteOptions {
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

/**
 * Async OpenAPI registration options with routes fixed before module compilation.
 *
 * @remarks
 * `documentPath` and `uiPath` belong to the outer registration because HTTP
 * routes are compiled before the injected options factory resolves.
 */
export type OpenApiAsyncModuleOptions = AsyncModuleOptions<
  Omit<OpenApiModuleOptions, keyof OpenApiRouteOptions>
> & OpenApiRouteOptions;

type ResolvedOpenApiRouteOptions = Required<OpenApiRouteOptions>;

type OpenApiOptionsProvider =
  | {
      scope: 'singleton';
      useValue: OpenApiModuleOptions;
    }
  | {
      inject?: InjectionToken[];
      scope: 'singleton';
      useFactory: (...deps: unknown[]) => MaybePromise<OpenApiModuleOptions>;
    };

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

function snapshotOpenApiModuleOptions(options: OpenApiModuleOptions): OpenApiModuleOptions {
  return createFrozenSnapshot({
    defaultErrorResponsesPolicy: options.defaultErrorResponsesPolicy,
    descriptors: options.descriptors ? cloneSnapshotValue(options.descriptors) : undefined,
    documentPath: options.documentPath,
    documentTransform: options.documentTransform,
    extraModels: options.extraModels ? [...options.extraModels] : undefined,
    securitySchemes: cloneRecord(options.securitySchemes),
    sources: options.sources ? cloneSnapshotValue(options.sources) : undefined,
    swaggerUiAssets: options.swaggerUiAssets ? { ...options.swaggerUiAssets } : undefined,
    title: options.title,
    ui: options.ui,
    uiPath: options.uiPath,
    version: options.version,
  });
}

function resolveOpenApiRouteOptions(options: OpenApiRouteOptions): ResolvedOpenApiRouteOptions {
  const normalizePath = (path: string): string => `/${path.split('/').filter(Boolean).join('/')}`;

  return {
    documentPath: normalizePath(options.documentPath ?? DEFAULT_DOCUMENT_PATH),
    uiPath: normalizePath(options.uiPath ?? DEFAULT_UI_PATH),
  };
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
    const snapshot = snapshotOpenApiModuleOptions(options);

    return this.createModule({
      scope: 'singleton',
      useValue: snapshot,
    }, resolveOpenApiRouteOptions(snapshot));
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
   *   documentPath: '/openapi/internal.json',
   *   inject: [ConfigService],
   *   uiPath: '/docs/internal',
   *   useFactory: (config) => ({
   *     title: config.get('APP_NAME'),
   *     version: config.get('APP_VERSION'),
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: OpenApiAsyncModuleOptions): ModuleType {
    const routes = resolveOpenApiRouteOptions(options);

    return this.createModule({
      inject: options.inject,
      scope: 'singleton',
      useFactory: async (...deps: unknown[]) => snapshotOpenApiModuleOptions({
        ...await options.useFactory(...deps),
        ...routes,
      }),
    }, routes);
  }

  private static createModule(
    optionsProvider: OpenApiOptionsProvider,
    routes: ResolvedOpenApiRouteOptions,
  ): ModuleType {
    const openApiModuleOptionsToken = Symbol('fluo.openapi.module-options');
    const openApiDocumentToken = Symbol('fluo.openapi.document');

    @Controller('')
    @Inject(openApiDocumentToken, openApiModuleOptionsToken)
    class OpenApiController {
      constructor(
        private readonly document: OpenApiDocument,
        private readonly options: OpenApiModuleOptions,
      ) {}

      @Get(routes.documentPath)
      getDocument() {
        return cloneSnapshotValue(this.document);
      }

      @Get(routes.uiPath)
      getSwaggerUi(_input: undefined, context: RequestContext): string {
        if (!(this.options.ui ?? false)) {
          throw new NotFoundException('Swagger UI is disabled.');
        }

        context.response.setHeader('content-type', 'text/html; charset=utf-8');

        return createSwaggerUiHtml(this.options.title, resolveSwaggerUiAssets(this.options.swaggerUiAssets), routes);
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

            return createFrozenSnapshot(buildOpenApiDocument({
              documentTransform: options.documentTransform,
              defaultErrorResponsesPolicy: options.defaultErrorResponsesPolicy,
              descriptors: registry.getDescriptors(),
              extraModels: options.extraModels,
              securitySchemes: options.securitySchemes,
              title: options.title,
              version: options.version,
            }));
          },
        },
      ],
    });

    return OpenApiRuntimeModule;
  }
}
