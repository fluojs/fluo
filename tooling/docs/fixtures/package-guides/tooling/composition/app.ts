import { Inject, Module } from '@fluojs/core';
import { Controller, FromPath, Get, RequestDto } from '@fluojs/http';
import { Path, ReactModule, Router } from '@fluojs/react';

import { CATALOG_VIEW, type CatalogView } from './contract';

/**
 * Cross-package composition app (@fluojs/react + @fluojs/http + @fluojs/core):
 * one provider serves an ordinary JSON controller and a React page router.
 * The React handler intentionally returns a plain value so the response keeps
 * the ordinary HTTP path without importing react in the fixture workspace.
 */

export class CatalogService implements CatalogView {
  find(sku: string): { sku: string; title: string } {
    return { sku, title: `Item ${sku}` };
  }
}

class SkuRequest {
  @FromPath('sku')
  sku = '';
}

@Inject(CatalogService)
@Controller('/api/catalog')
export class CatalogApiController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('/:sku')
  @RequestDto(SkuRequest)
  get(input: SkuRequest): { sku: string; title: string } {
    return this.catalog.find(input.sku);
  }
}

@Inject(CATALOG_VIEW)
@Router('/catalog')
export class CatalogPageRouter {
  constructor(private readonly view: CatalogView) {}

  @Path('/:sku')
  @RequestDto(SkuRequest)
  show(input: SkuRequest): { sku: string; title: string } {
    return this.view.find(input.sku);
  }
}

@Module({
  controllers: [CatalogApiController],
  providers: [CatalogService, { provide: CATALOG_VIEW, useExisting: CatalogService }],
  exports: [CATALOG_VIEW],
})
export class CatalogModule {}

@Module({
  imports: [
    CatalogModule,
    ReactModule.forRoot({ controllers: [CatalogPageRouter], imports: [CatalogModule] }),
  ],
})
export class CompositionRootModule {}
