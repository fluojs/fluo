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
  PageMetadata,
  ReactModule,
  ReactNavigationPage,
  Router,
  type ReactPageRenderer,
} from '@fluojs/react';
import { IsIn, IsString, MinLength } from '@fluojs/validation';
import { createElement } from 'react';

import type { ReactViteExamplePresentation } from './presentation';
import { createPrefetchPageRouter } from './prefetch-page';
import { createCatalogRouter, type CatalogControl } from './catalog';

const ASSET_FILE_PATTERN = /^[a-zA-Z0-9._-]+\.(?:css|js|svg)$/u;

export type ReactViteExampleModuleOptions = {
  readonly catalogControl?: CatalogControl;
  readonly clientDirectory?: URL;
  readonly presentation?: ReactViteExamplePresentation;
};

class ReactViteExamplePresentationError extends Error {
  readonly name = 'ReactViteExamplePresentationError';
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

class CatalogReadGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    context.requestContext.response.setHeader('x-example-read-guard', 'approved');
    return true;
  }
}

class CatalogMutationInterceptor implements Interceptor {
  readonly #requestId = randomBytes(8).toString('hex');

  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    context.requestContext.response.setHeader('x-example-interceptor', 'request-scoped');
    context.requestContext.response.setHeader('x-example-request-scope', this.#requestId);
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

export function createReactViteExampleModule(options: ReactViteExampleModuleOptions = {}) {
  const presentation = () => {
    if (options.presentation === undefined) {
      throw new ReactViteExamplePresentationError('The inspection module has no configured page presentation.');
    }
    return options.presentation;
  };
  const catalog = createCatalogRouter((props, context) => {
    const { assets, document: ProductDocument } = presentation();
    return ReactNavigationPage.create(createElement(ProductDocument, {
      catalog: props, navigationBuildId: assets.buildId, preview: false, productName: '',
      routeParams: context.request.params, routeUrl: context.request.url, saved: false, sku: '', stylesheets: assets.css,
    }), { module: './navigation-catalog.ts', props: { ...props } }, props.sessionDemo ? undefined : { prefetch: 'public' });
  }, options.catalogControl);
  const renderPage: ReactPageRenderer = (...args) => presentation().renderPage(...args);

  @Inject(ProductCatalog)
  @Router('/products')
  class ProductPageRouter {
    constructor(private readonly catalog: ProductCatalog) {}

    @PageMetadata(({ request }) => ({
      title: `Catalog item ${request.params.sku}`,
      meta: [
        { name: 'description', content: `Product ${request.params.sku}` },
        { property: 'og:title', content: `Product ${request.params.sku}` },
      ],
      links: [{ rel: 'canonical', href: request.url }],
    }))
    @Path('/:sku')
    @RequestDto(ProductPageRequest)
    @UseGuards(CatalogReadGuard)
    @UseInterceptors(CatalogMutationInterceptor)
    show(input: ProductPageRequest, context: RequestContext) {
      const { assets, document: ProductDocument } = presentation();
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
      const { assets, document: ProductDocument } = presentation();
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

    @PageMetadata(() => ({
      title: 'Admin QR',
      meta: [{ name: 'description', content: 'QR access' }],
      links: [{ rel: 'canonical', href: '/admin/qr' }],
    }))
    @Path('/qr')
    qr(_input: undefined, context: RequestContext) {
      return this.page('qr', context);
    }

    @PageMetadata(() => ({
      title: 'Admin songs',
      meta: [{ name: 'description', content: 'Songs catalog' }],
    }))
    @Path('/songs')
    songs(_input: undefined, context: RequestContext) {
      return this.page('songs', context);
    }
  }

  const PrefetchPageRouter = createPrefetchPageRouter(presentation);

  @Router('/deployment')
  class DeploymentRouter {
    @Path('/b-only')
    show(_input: undefined, context: RequestContext) {
      const { assets, document: ProductDocument } = presentation();
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
      if (options.clientDirectory === undefined) {
        throw new ReactViteExamplePresentationError('The inspection module has no configured asset directory.');
      }
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
        ...(options.presentation === undefined ? {} : { navigationBuildId: options.presentation.assets.buildId }),
        controllers: [ProductPageRouter, AdminPageRouter, PrefetchPageRouter, DeploymentRouter, catalog.router],
        middleware: [CatalogRequestMiddleware, ...catalog.middleware],
        providers: [
          ...catalog.providers,
          CatalogMutationGuard,
          CatalogReadGuard,
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
  class ReactViteExampleModule {
    static readonly errorRepresentation = catalog.errorRepresentation;
    static readonly applicationOptions = { errorRepresentation: catalog.errorRepresentation };
  }

  return ReactViteExampleModule;
}

export const AppModule = createReactViteExampleModule();
export const applicationOptions = AppModule.applicationOptions;
