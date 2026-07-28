import { readFile } from 'node:fs/promises';

import { Inject, Module } from '@fluojs/core';
import {
  type CallHandler,
  Controller,
  ForbiddenException,
  FromBody,
  FromPath,
  FromQuery,
  Get,
  type Guard,
  type GuardContext,
  type Interceptor,
  type InterceptorContext,
  type Middleware,
  type MiddlewareContext,
  type Next,
  NotFoundException,
  Optional,
  Post,
  RequestDto,
  type RequestContext,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import {
  Path,
  ReactModule,
  Router,
  createReactServerEntry,
  type ReactPageRenderer,
} from '@fluojs/react';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { IsIn, IsString, MinLength } from '@fluojs/validation';
import { createElement } from 'react';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument } from './page';

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js)$/u;

export type ReactViteExampleModuleOptions = {
  readonly clientDirectory: URL;
  readonly manifest: unknown;
};

class ReactViteExampleManifestError extends Error {
  readonly name = 'ReactViteExampleManifestError';
}

class ProductPageRequest {
  @MinLength(3)
  @IsString()
  @FromPath('sku')
  sku = '';

  @IsIn(['true', 'false'])
  @Optional()
  @FromQuery('preview')
  preview?: string;

  @IsIn(['true'])
  @Optional()
  @FromQuery('updated')
  updated?: string;
}

class ProductMutationRequest {
  @MinLength(3, {
    code: 'PRODUCT_NAME_TOO_SHORT',
    message: 'Product name must contain at least 3 characters.',
  })
  @IsString()
  @FromBody('name')
  name = '';

  @MinLength(3)
  @IsString()
  @FromPath('sku')
  sku = '';
}

class AssetRequest {
  @FromPath('file')
  file = '';
}

class CatalogMutationGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    if (context.requestContext.request.headers['x-example-user'] !== 'catalog-editor') {
      throw new ForbiddenException('Catalog mutations require an authorized editor.');
    }

    return true;
  }
}

class CatalogMutationInterceptor implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    context.requestContext.response.setHeader('x-example-interceptor', 'request-scoped');
    return next.handle();
  }
}

class CatalogRequestMiddleware implements Middleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    context.response.setHeader('x-example-middleware', 'react-native-form');
    await next();
  }
}

class ProductCatalog {
  readonly #names = new Map<string, string>();

  findName(sku: string): string {
    return this.#names.get(sku) ?? `Catalog item ${sku}`;
  }

  rename(sku: string, name: string): void {
    this.#names.set(sku, name);
  }
}

export function createReactViteExampleModule(options: ReactViteExampleModuleOptions) {
  const result = createReactViteAssetManifest({
    base: '/assets/',
    entries: {
      client: 'src/entry-client.ts',
      server: 'src/entry-server.ts',
    },
    identifierPrefix: REACT_IDENTIFIER_PREFIX,
    manifest: options.manifest,
  });

  if (!result.ok) {
    throw new ReactViteExampleManifestError(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  const assets = result.manifest;
  const renderPage: ReactPageRenderer = (page) => createReactServerEntry(page, assets.hydrationOptions);

  @Inject(ProductCatalog)
  @Router('/products')
  class ProductPageRouter {
    constructor(private readonly catalog: ProductCatalog) {}

    @Path('/:sku')
    @RequestDto(ProductPageRequest)
    show(input: ProductPageRequest, context: RequestContext) {
      return createElement(ProductDocument, {
        preview: input.preview === 'true',
        productName: this.catalog.findName(input.sku),
        routeParams: context.request.params,
        routeUrl: context.request.url,
        saved: input.updated === 'true',
        sku: input.sku,
        stylesheets: assets.css,
      });
    }

    @Post('/:sku')
    @RequestDto(ProductMutationRequest)
    @UseGuards(CatalogMutationGuard)
    @UseInterceptors(CatalogMutationInterceptor)
    update(input: ProductMutationRequest, context: RequestContext) {
      this.catalog.rename(input.sku, input.name);
      context.response.redirect(303, `/products/${encodeURIComponent(input.sku)}?updated=true`);
    }
  }

  @Controller('/assets')
  class ViteAssetController {
    @Get('/:file')
    @RequestDto(AssetRequest)
    async serve(input: AssetRequest, context: RequestContext) {
      if (!ASSET_FILE_PATTERN.test(input.file)) {
        throw new NotFoundException('Vite asset not found.');
      }

      try {
        const body = await readFile(new URL(input.file, options.clientDirectory));
        context.response.setHeader(
          'Content-Type',
          input.file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        );
        return body;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new NotFoundException('Vite asset not found.', { cause: error });
        }
        throw error;
      }
    }
  }

  @Module({
    controllers: [ViteAssetController],
    imports: [
      ReactModule.forRoot({
        controllers: [ProductPageRouter],
        middleware: [CatalogRequestMiddleware],
        providers: [
          CatalogMutationGuard,
          ProductCatalog,
          {
            provide: CatalogMutationInterceptor,
            scope: 'request',
            useClass: CatalogMutationInterceptor,
          },
        ],
        renderPage,
      }),
    ],
  })
  class ReactViteExampleModule {}

  return ReactViteExampleModule;
}
