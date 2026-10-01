import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

import { enforceReactPageCatalogContract } from './react-page-catalog-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const path = 'packages/react/src/page-catalog.ts';
const source = readFileSync(resolve(root, path), 'utf8');

it('accepts the current compiled HTTP catalog provenance', () => {
  expect(() => enforceReactPageCatalogContract()).not.toThrow();
});

it.each(['undefined', "'uri'", 'route.path.startsWith("/v") ? "uri" : undefined'])(
  'rejects erased or guessed version selection (%s)',
  (replacement) => {
    const variant = source.replace(
      'versionSelection: descriptor.metadata.versionSelection',
      `versionSelection: ${replacement}`,
    );
    expect(variant).not.toBe(source);
    expect(() => enforceReactPageCatalogContract((candidate: string) =>
      candidate === path ? variant : readFileSync(resolve(root, candidate), 'utf8'),
    )).toThrow(/authoritative HTTP version selection/u);
  },
);
