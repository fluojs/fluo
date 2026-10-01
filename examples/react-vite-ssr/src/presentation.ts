import { randomBytes } from 'node:crypto';
import { createReactServerEntry, type ReactPageRenderer } from '@fluojs/react';
import { createReactViteAssetManifest } from '@fluojs/react/vite';
import { cloneElement, isValidElement } from 'react';

import { REACT_IDENTIFIER_PREFIX } from './hydration';
import { ProductDocument, type ProductDocumentProps } from './page';

export class ReactViteExampleManifestError extends Error {
  readonly name = 'ReactViteExampleManifestError';
}

export function createReactViteExamplePresentation(manifest: unknown) {
  const result = createReactViteAssetManifest({
    base: '/assets/',
    entries: { client: 'src/entry-client.ts', server: 'src/entry-server.ts' },
    identifierPrefix: REACT_IDENTIFIER_PREFIX,
    manifest,
  });
  if (!result.ok) {
    throw new ReactViteExampleManifestError(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const assets = result.manifest;
  for (const module of ['src/navigation-product.ts', 'src/navigation-admin.ts']) {
    if (assets.assetMap[module] === undefined) {
      throw new ReactViteExampleManifestError(`The client build has no ${module} destination module.`);
    }
  }
  const renderPage: ReactPageRenderer = (page, _context, _policies, initialPage) => {
    if (page.type !== ProductDocument || !isValidElement<ProductDocumentProps>(page)) {
      throw new ReactViteExampleManifestError('The example page must render with ProductDocument.');
    }
    const nonce = randomBytes(16).toString('base64');
    return createReactServerEntry(cloneElement(page, {
      initialPage,
      routeMetadata: initialPage?.payload.metadata,
    }), {
      ...assets.hydrationOptions,
      headers: {
        ...(initialPage === undefined ? {} : { 'Cache-Control': 'private, no-store' }),
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; img-src 'self' data:`,
      },
      nonce,
    });
  };
  return { assets, document: ProductDocument, renderPage };
}

export type ReactViteExamplePresentation = ReturnType<typeof createReactViteExamplePresentation>;
