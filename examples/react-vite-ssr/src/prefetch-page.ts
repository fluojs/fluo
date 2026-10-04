import { ForbiddenException, FromPath, NotFoundException, RequestDto, type RequestContext } from '@fluojs/http';
import { Path, ReactNavigationPage, Router } from '@fluojs/react';
import { createElement } from 'react';

import type { ReactViteExamplePresentation } from './presentation';

class PrefetchRequest {
  @FromPath('scenario')
  scenario = '';
}

export function createPrefetchPageRouter(presentation: () => ReactViteExamplePresentation) {
  @Router('/prefetch')
  class PrefetchPageRouter {
    readonly visits = new Map<string, number>();

    @Path('/:scenario')
    @RequestDto(PrefetchRequest)
    show(input: PrefetchRequest, context: RequestContext) {
      const { assets, document: ProductDocument } = presentation();
      const stylesheets = assets.css;
      const { scenario } = input;
      if (scenario === 'missing') {
        throw new NotFoundException('Prefetch destination not found.');
      }
      if (scenario === 'redirect') {
        context.response.redirect(302, '/admin/songs');
        return;
      }
      if (scenario === 'auth' && !context.request.headers.cookie?.includes('session=alice')) {
        throw new ForbiddenException('The auth fixture requires a session cookie.');
      }
      if (scenario === 'no-store') {
        context.response.setHeader('Cache-Control', 'no-store');
      }
      if (scenario === 'set-cookie') {
        context.response.setHeader('Set-Cookie', 'prefetch-example=1; Path=/; SameSite=Lax');
      }
      if (scenario === 'vary-cookie') {
        context.response.setHeader('Vary', 'Cookie');
      }

      const visit = (this.visits.get(scenario) ?? 0) + 1;
      this.visits.set(scenario, visit);
      const productName = `Prefetch ${scenario} visit ${visit}`;
      return ReactNavigationPage.create(createElement(ProductDocument, {
        preview: false,
        productName,
        routeParams: context.request.params,
        routeUrl: context.request.url,
        saved: false,
        sku: scenario,
        stylesheets,
      }), {
        module: './navigation-product.ts',
        props: { preview: false, productName, sku: scenario },
      }, scenario.startsWith('public-') || scenario === 'no-store'
        || scenario === 'set-cookie' || scenario === 'vary-cookie'
        ? { prefetch: 'public' }
        : undefined);
    }
  }

  return PrefetchPageRouter;
}
