import { Module } from '@fluojs/core';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  createReactServerEntry,
  Path,
  ReactModule,
  type ReactPageRenderer,
  type ReactSuspenseFallback,
  Router,
  SuspenseFallback,
} from './index.js';
import { createReactRenderPolicyDecorator } from './render-policy-metadata.js';

const PrimaryFallback: ReactSuspenseFallback = () => null;
const SecondaryFallback: ReactSuspenseFallback = () => null;
const renderPage: ReactPageRenderer = (page) => createReactServerEntry(page);

describe('React render policy diagnostics', () => {
  it('rejects duplicate Suspense fallback policies on the same decoration site during bootstrap', async () => {
    // Given: one router class declares the Suspense fallback policy twice.
    @SuspenseFallback(PrimaryFallback)
    @SuspenseFallback(SecondaryFallback)
    @Router('/duplicate-suspense-fallback')
    class DuplicateFallbackRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [DuplicateFallbackRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap validates the duplicate fallback declarations.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: the stable fallback-specific diagnostic rejects the declaration.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-duplicate-suspense-fallback',
    });
  });

  it('rejects an undefined PageLayout reference during bootstrap', async () => {
    const invalidPageLayout = createReactRenderPolicyDecorator('layout', undefined);

    // Given: runtime JavaScript records an undefined layout reference on a valid router.
    @invalidPageLayout
    @Router('/undefined-page-layout')
    class UndefinedPageLayoutRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [UndefinedPageLayoutRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap validates the existing layout policy record.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: undefined is rejected rather than treated as an absent policy.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-reference',
      target: 'UndefinedPageLayoutRouter',
    });
  });

  it('rejects an undefined SuspenseFallback reference during bootstrap', async () => {
    const invalidSuspenseFallback = createReactRenderPolicyDecorator('suspense-fallback', undefined);

    // Given: runtime JavaScript records an undefined fallback reference on a valid Path method.
    @Router('/undefined-suspense-fallback')
    class UndefinedSuspenseFallbackRouter {
      @invalidSuspenseFallback
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [UndefinedSuspenseFallbackRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap validates the existing fallback policy record.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: undefined is rejected with the stable invalid-reference diagnostic.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-reference',
      target: 'UndefinedSuspenseFallbackRouter.page',
    });
  });
});
