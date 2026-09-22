import { publicToken } from '@fluojs/core';

/**
 * Cross-package composition contract: the API controller and the React page
 * router both serve the catalog through this token, while the implementing
 * class stays private to CatalogModule.
 */
export interface CatalogView {
  find(sku: string): { sku: string; title: string };
}

export const CATALOG_VIEW = publicToken<CatalogView>('docs-tooling/composition/catalog-view/v1');
