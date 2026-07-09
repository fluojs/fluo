import { Inject } from '@fluojs/core';
import {
  type CallHandler,
  FromPath,
  FromQuery,
  type Guard,
  type GuardContext,
  Header,
  type Interceptor,
  type InterceptorContext,
  type Middleware,
  type MiddlewareContext,
  type Next,
  Optional,
  RequestDto,
  UseGuards,
  UseInterceptors,
} from '@fluojs/http';
import { Path, Router, createReactServerEntry, type ReactAssetMap } from '@fluojs/react';
import { Suspense, createElement } from 'react';

const HYDRATION_ASSETS = {
  'client.js': '/assets/react-stable-ssr.client.js',
  'styles.css': '/assets/react-stable-ssr.css',
} as const satisfies ReactAssetMap;

type ProductPageModel = {
  readonly clientEntry: string;
  readonly previewLabel: string;
  readonly sku: string;
  readonly title: string;
};

type ProductPageProps = {
  readonly assetMap: ReactAssetMap;
  readonly model: ProductPageModel;
};

export class ProductPageRequest {
  @FromPath('sku')
  sku = '';

  @Optional()
  @FromQuery('preview')
  preview?: string;
}

export class ProductCatalogService {
  renderProduct(input: ProductPageRequest): ProductPageModel {
    const previewLabel = input.preview === 'true' ? 'Preview mode' : 'Published mode';

    return {
      clientEntry: HYDRATION_ASSETS['client.js'],
      previewLabel,
      sku: input.sku,
      title: `Catalog item ${input.sku}`,
    };
  }
}

export class ReactSsrTraceMiddleware implements Middleware {
  async handle(context: MiddlewareContext, next: Next): Promise<void> {
    context.response.setHeader('x-example-middleware', 'react-stable-ssr');
    await next();
  }
}

export class PreviewGuard implements Guard {
  canActivate(context: GuardContext): boolean {
    context.requestContext.response.setHeader('x-example-guard', context.requestContext.request.params.sku ?? 'missing');
    return true;
  }
}

export class RenderPhaseInterceptor implements Interceptor {
  async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
    context.requestContext.response.setHeader('x-example-interceptor', 'before-render');
    return next.handle();
  }
}

function ProductPage({ assetMap, model }: ProductPageProps) {
  return createElement(
    'html',
    { lang: 'en' },
    createElement(
      'body',
      null,
      createElement(
        'main',
        {
          'data-client-entry': assetMap['client.js'],
          'data-stylesheet': assetMap['styles.css'],
        },
        createElement('h1', null, model.title),
        createElement('p', null, model.previewLabel),
        createElement('p', null, `DTO-bound sku: ${model.sku}`),
        createElement(Suspense, { fallback: createElement('p', null, 'Loading recommendations…') },
          createElement('section', null, `Hydrate with ${model.clientEntry}`),
        ),
      ),
    ),
  );
}

@Inject(ProductCatalogService)
@UseGuards(PreviewGuard)
@UseInterceptors(RenderPhaseInterceptor)
@Router('/products')
export class ProductPageRouter {
  constructor(private readonly catalog: ProductCatalogService) {}

  @Header('x-example-route', 'react-page')
  @Path('/:sku')
  @RequestDto(ProductPageRequest)
  show(input: ProductPageRequest) {
    const model = this.catalog.renderProduct(input);

    return createReactServerEntry(createElement(ProductPage, { assetMap: HYDRATION_ASSETS, model }), {
      assetMap: HYDRATION_ASSETS,
      bootstrapModules: [HYDRATION_ASSETS['client.js'], HYDRATION_ASSETS['client.js']],
      bootstrapScriptContent: 'window.__FLUO_REACT_STABLE_SSR__ = true;',
      headers: { 'x-example-entry': 'react-server-entry' },
      identifierPrefix: 'fluo-react-stable-',
      nonce: 'example-nonce',
    });
  }
}
