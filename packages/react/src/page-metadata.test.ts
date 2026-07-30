import { Module, type Token } from '@fluojs/core';
import type { RequestScopeContainer } from '@fluojs/di';
import { type FrameworkRequest, type FrameworkResponse, Get } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  createReactPageMetadataElements,
  createReactServerEntry,
  getReactRenderPolicies,
  PageMetadata,
  Path,
  ReactModule,
  type ReactPageMetadataFactory,
  type ReactPageRenderer,
  type ReactRenderContext,
  Router,
  resolveReactPageMetadata,
} from './index.js';
import { createReactRenderPolicyDecorator } from './render-policy-metadata.js';

const testContainer: RequestScopeContainer = {
  async dispose(): Promise<void> {},
  async resolve<Value>(_token: Token<Value>): Promise<Value> {
    return await new Promise<Value>(() => undefined);
  },
};

const testRequest: FrameworkRequest = {
  body: undefined,
  cookies: {},
  headers: {},
  method: 'GET',
  params: { productId: '42' },
  path: '/products/42',
  query: {},
  raw: {},
  url: '/products/42',
};

const testResponse: FrameworkResponse = {
  committed: false,
  headers: {},
  redirect() {},
  send() {},
  setHeader() {},
  setStatus() {},
};

const testRenderContext: ReactRenderContext = {
  container: testContainer,
  request: testRequest,
  requestId: 'request-42',
  response: testResponse,
};

const staticMetadata: ReactPageMetadataFactory = () => ({ title: 'Static title' });
const renderPage: ReactPageRenderer = (page) => createReactServerEntry(page);

describe('React page metadata policy', () => {
  it('resolves inherited factories broad-to-specific with deterministic title, meta, and link composition', () => {
    const factoryOrder: string[] = [];
    const BaseClassMetadata: ReactPageMetadataFactory = () => {
      factoryOrder.push('base-class');
      return {
        links: [{ href: '/base.css', rel: 'stylesheet' }],
        meta: [{ content: 'base', name: 'description' }],
        title: 'Base title',
      };
    };
    const DerivedClassMetadata: ReactPageMetadataFactory = () => {
      factoryOrder.push('derived-class');
      return {
        meta: [{ content: 'product', property: 'og:type' }],
        title: 'Derived title',
      };
    };
    const BaseMethodMetadata: ReactPageMetadataFactory = () => {
      factoryOrder.push('base-method');
      return {
        links: [{ href: '/base.css', media: 'screen', rel: 'stylesheet' }],
        meta: [{ content: 'base method', name: 'description' }],
      };
    };
    const DerivedMethodMetadata: ReactPageMetadataFactory = ({ request }) => {
      factoryOrder.push('derived-method');
      return {
        links: [{ href: `/products/${request.params.productId}.css`, rel: 'stylesheet' }],
        title: `Product ${request.params.productId}`,
      };
    };

    // Given: metadata factories are declared across class and method inheritance sites.
    @PageMetadata(BaseClassMetadata)
    @Router('/products')
    class BaseRouter {
      @PageMetadata(BaseMethodMetadata)
      @Path('/:productId')
      page() {
        return null;
      }
    }

    @PageMetadata(DerivedClassMetadata)
    class DerivedRouter extends BaseRouter {
      @PageMetadata(DerivedMethodMetadata)
      @Path('/:productId')
      override page() {
        return null;
      }
    }

    // When: the matched page policies are resolved for one request.
    const policies = getReactRenderPolicies(DerivedRouter, 'page');
    const metadata = resolveReactPageMetadata(policies, testRenderContext);

    // Then: factories run broad-to-specific and nearer duplicate identities replace earlier values.
    expect(factoryOrder).toEqual(['base-class', 'derived-class', 'base-method', 'derived-method']);
    expect(metadata).toEqual({
      links: [
        { href: '/base.css', media: 'screen', rel: 'stylesheet' },
        { href: '/products/42.css', rel: 'stylesheet' },
      ],
      meta: [
        { content: 'product', property: 'og:type' },
        { content: 'base method', name: 'description' },
      ],
      title: 'Product 42',
    });
  });

  it('escapes title text and descriptor attributes through ordinary React elements', () => {
    // Given: resolved metadata contains values that would be unsafe under raw HTML interpolation.
    const metadata = {
      links: [{ href: '/?next="<unsafe>"', rel: 'canonical' }],
      meta: [{ content: '" /><script>', name: 'description' }],
      title: '<script>alert("x")</script>',
    } as const;

    // When: the bounded metadata helper creates and renders ordinary React elements.
    const markup = renderToStaticMarkup(
      createElement(Fragment, null, ...createReactPageMetadataElements(metadata)),
    );

    // Then: React escapes text and attributes without exposing raw script markup.
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(markup).toContain('content="&quot; /&gt;&lt;script&gt;"');
    expect(markup).toContain('href="/?next=&quot;&lt;unsafe&gt;&quot;"');
  });

  it('rejects duplicate metadata declarations on one decoration site during bootstrap', async () => {
    // Given: one valid React router class declares PageMetadata twice.
    @PageMetadata(staticMetadata)
    @PageMetadata(staticMetadata)
    @Router('/duplicate-page-metadata')
    class DuplicateMetadataRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [DuplicateMetadataRouter], renderPage })],
    })
    class AppModule {}

    // When: module bootstrap validates the metadata policy sites.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: the duplicate has a stable metadata-specific diagnostic code.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-duplicate-page-metadata',
      target: 'DuplicateMetadataRouter',
    });
  });

  it('rejects metadata declarations outside the Path page seam during bootstrap', async () => {
    // Given: an ordinary HTTP method is decorated with React page metadata.
    @Router('/invalid-page-metadata-target')
    class InvalidMetadataTargetRouter {
      @PageMetadata(staticMetadata)
      @Get('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [InvalidMetadataTargetRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap checks the declaration owner against the React page seam.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: the metadata policy cannot attach to an ordinary HTTP handler.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-target',
      target: 'InvalidMetadataTargetRouter.page',
    });
  });

  it('rejects metadata policies without an application page renderer during bootstrap', async () => {
    // Given: a valid React page declares metadata without configuring renderPage.
    @PageMetadata(staticMetadata)
    @Router('/missing-page-metadata-renderer')
    class MissingMetadataRendererRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [MissingMetadataRendererRouter] })],
    })
    class AppModule {}

    // When: module bootstrap validates that each render policy has a consumer.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: unused metadata fails before request dispatch.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-missing-page-renderer',
      target: 'MissingMetadataRendererRouter',
    });
  });

  it('rejects an invalid metadata factory reference during bootstrap', async () => {
    const invalidMetadata = createReactRenderPolicyDecorator('page-metadata', undefined);

    // Given: runtime JavaScript records an undefined factory on a valid React router.
    @invalidMetadata
    @Router('/invalid-page-metadata-factory')
    class InvalidMetadataFactoryRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [InvalidMetadataFactoryRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap validates the recorded metadata factory reference.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: undefined is rejected rather than treated as an absent declaration.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-reference',
      target: 'InvalidMetadataFactoryRouter',
    });
  });
});
