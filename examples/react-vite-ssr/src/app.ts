import { randomBytes } from 'node:crypto';
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
  ReactNavigationPage,
  Router,
  createReactServerEntry,
  type ReactPageRenderer,
} from '@fluojs/react';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { IsIn, IsString, MinLength } from '@fluojs/validation';
import { createElement } from 'react';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { InitialPageContext, ProductDocument } from './page';
import { createPrefetchPageRouter } from './prefetch-page';

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js|svg)$/u;

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
  if (assets.assetMap['src/navigation-product.ts'] === undefined) {
    throw new ReactViteExampleManifestError('The client build has no navigation-product destination module.');
  }
  if (assets.assetMap['src/navigation-admin.ts'] === undefined) {
    throw new ReactViteExampleManifestError('The client build has no navigation-admin destination module.');
  }
  const renderPage: ReactPageRenderer = (page, _context, _policies, initialPage) => {
    const nonce = randomBytes(16).toString('base64');
    return createReactServerEntry(createElement(InitialPageContext.Provider, { value: initialPage }, page), {
      ...assets.hydrationOptions,
      headers: {
        ...(initialPage === undefined ? {} : { 'Cache-Control': 'private, no-store' }),
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; img-src 'self' data:`,
      },
      nonce,
    });
  };

  @Inject(ProductCatalog)
  @Router('/products')
  class ProductPageRouter {
    constructor(private readonly catalog: ProductCatalog) {}

    @Path('/:sku')
    @RequestDto(ProductPageRequest)
    show(input: ProductPageRequest, context: RequestContext) {
      const productName = this.catalog.findName(input.sku);
      const preview = input.preview === 'true';
      return ReactNavigationPage.create(createElement(ProductDocument, {
        preview,
        productName,
        navigationBuildId: assets.buildId,
        routeParams: context.request.params,
        routeUrl: context.request.url,
        saved: input.updated === 'true',
        sku: input.sku,
        stylesheets: assets.css,
      }), {
        module: './navigation-product.ts',
        props: { preview, productName, sku: input.sku },
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

  @Router('/admin')
  class AdminPageRouter {
    private page(page: 'qr' | 'songs', context: RequestContext) {
      return ReactNavigationPage.create(createElement(ProductDocument, {
        adminPage: page,
        preview: false,
        productName: '',
        navigationBuildId: assets.buildId,
        routeParams: context.request.params,
        routeUrl: context.request.url,
        saved: false,
        sku: '',
        stylesheets: assets.css,
      }), {
        module: './navigation-admin.ts',
        props: { page },
      });
    }

    @Path('/qr')
    qr(_input: undefined, context: RequestContext) {
      return this.page('qr', context);
    }

    @Path('/songs')
    songs(_input: undefined, context: RequestContext) {
      return this.page('songs', context);
    }
  }

  const PrefetchPageRouter = createPrefetchPageRouter(assets.css);

  @Router('/deployment')
  class DeploymentRouter {
    @Path('/b-only')
    show(_input: undefined, context: RequestContext) {
      if (assets.assetMap['src/navigation-b-only.ts'] === undefined) {
        throw new NotFoundException('This destination is absent from the selected build.');
      }
      return ReactNavigationPage.create(createElement(ProductDocument, {
        navigationBuildId: assets.buildId,
        preview: false,
        productName: 'B-only destination',
        routeParams: context.request.params,
        routeUrl: context.request.url,
        saved: false,
        sku: '',
        stylesheets: assets.css,
      }), {
        module: './navigation-b-only.ts',
        props: {},
      });
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
        context.response.setHeader('Cache-Control', /-[a-zA-Z0-9_-]{6,}\.(?:js|css|svg)$/u.test(input.file)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300');
        context.response.setHeader(
          'Content-Type',
          input.file.endsWith('.svg') ? 'image/svg+xml'
            : input.file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        );
        return body;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          context.response.setHeader('X-Fluo-Asset-Status', 'missing');
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
        navigationBuildId: assets.buildId,
        controllers: [ProductPageRouter, AdminPageRouter, PrefetchPageRouter, DeploymentRouter],
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
