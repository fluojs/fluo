import { Module } from '@fluojs/core';
import { Get } from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  createReactServerEntry,
  getReactRenderPolicies,
  PageLayout,
  Path,
  ReactModule,
  type ReactPageLayout,
  type ReactPageRenderer,
  type ReactSuspenseFallback,
  Router,
  SuspenseFallback,
} from './index.js';

const BaseLayout: ReactPageLayout = ({ children }) => children;
const DerivedLayout: ReactPageLayout = ({ children }) => children;
const BaseMethodLayout: ReactPageLayout = ({ children }) => children;
const DerivedMethodLayout: ReactPageLayout = ({ children }) => children;
const BaseFallback: ReactSuspenseFallback = () => null;
const MethodFallback: ReactSuspenseFallback = () => null;
const renderPage: ReactPageRenderer = (page) => createReactServerEntry(page);

describe('React render policy decorators', () => {
  it('resolves inherited class layouts before method layouts and uses the nearest fallback', () => {
    // Given: inherited class and method policies with a method-level fallback override.
    @PageLayout(BaseLayout)
    @SuspenseFallback(BaseFallback)
    @Router('/pages')
    class BaseRouter {
      @PageLayout(BaseMethodLayout)
      @Path('/')
      page() {
        return null;
      }
    }

    @PageLayout(DerivedLayout)
    class DerivedRouter extends BaseRouter {
      @PageLayout(DerivedMethodLayout)
      @SuspenseFallback(MethodFallback)
      @Path('/')
      override page() {
        return null;
      }
    }

    // When: the application renderer-facing policy snapshot is resolved.
    const policies = getReactRenderPolicies(DerivedRouter, 'page');

    // Then: layouts are outer-to-inner and the nearest fallback wins.
    expect(policies.layouts).toEqual([
      BaseLayout,
      DerivedLayout,
      BaseMethodLayout,
      DerivedMethodLayout,
    ]);
    expect(policies.suspenseFallback).toBe(MethodFallback);
  });

  it('rejects duplicate policies on the same decoration site during bootstrap', async () => {
    // Given: one router class declares the same policy kind twice.
    @PageLayout(BaseLayout)
    @PageLayout(DerivedLayout)
    @Router('/duplicate-policy')
    class DuplicatePolicyRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [DuplicatePolicyRouter], renderPage })],
    })
    class AppModule {}

    // When: the application resolves React module lifecycle providers.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: a stable bootstrap diagnostic rejects the duplicate declaration.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-duplicate-page-layout',
    });
  });

  it('rejects render policies without an application page renderer during bootstrap', async () => {
    // Given: a React page declares a layout but ReactModule has no renderPage callback.
    @PageLayout(BaseLayout)
    @Router('/missing-policy-renderer')
    class MissingRendererRouter {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [MissingRendererRouter] })],
    })
    class AppModule {}

    // When: application bootstrap validates the registered React routers.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: unused render policy metadata fails before any request dispatch.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-missing-page-renderer',
    });
  });

  it('rejects method policies attached outside the Path page seam during bootstrap', async () => {
    // Given: an ordinary HTTP GET method carries React-only render policy metadata.
    @Router('/invalid-policy-target')
    class InvalidTargetRouter {
      @PageLayout(BaseMethodLayout)
      @Get('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [InvalidTargetRouter], renderPage })],
    })
    class AppModule {}

    // When: application bootstrap validates render policy targets.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: the policy does not silently join an ordinary HTTP handler.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-target',
    });
  });

  it('rejects inherited class policies declared outside the Router seam during bootstrap', async () => {
    // Given: a plain base class declares React-only policy metadata before a derived router inherits it.
    @PageLayout(BaseLayout)
    class InvalidPolicyBase {}

    @Router('/invalid-inherited-policy-target')
    class InvalidInheritedTargetRouter extends InvalidPolicyBase {
      @Path('/')
      page() {
        return null;
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [InvalidInheritedTargetRouter], renderPage })],
    })
    class AppModule {}

    // When: bootstrap validates the owner of every inherited policy declaration.
    const bootstrap = bootstrapApplication({ rootModule: AppModule });

    // Then: a derived Router marker does not legalize a policy declared on a plain base class.
    await expect(bootstrap).rejects.toMatchObject({
      code: 'react-render-policy-invalid-target',
      target: 'InvalidPolicyBase',
    });
  });
});
