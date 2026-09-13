import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceCacheManagerNestjsMigrationDocs } from './cache-manager-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_KEY_STRATEGY_CONTRACT =
  '<!-- fluo:cache-http-key-strategy: default=route+query;route=query-insensitive-opt-in;full=removed -->';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS cache-manager migration documentation', () => {
  it('keeps the source-backed migration identifiers synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    ['packages/cache-manager/src/module.ts', 'httpKeyStrategy: normalizeHttpKeyStrategy(options.httpKeyStrategy)'],
    ['packages/cache-manager/src/decorators.ts', 'export function CacheTTL(ttlSeconds: number): StandardMethodDecoratorFn'],
    ['packages/cache-manager/src/types.ts', "store?: 'memory' | 'redis' | CacheStore;"],
  ] as const)('reports source drift in %s', (driftedPath, expectedMarker) => {
    // Given
    const readWithoutSourceContract = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs(readWithoutSourceContract);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(expectedMarker);
  });

  it.each([
    'packages/cache-manager/README.md',
    'packages/cache-manager/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'book/01-fluoblog/ch20-caching.md',
    'book/01-fluoblog/ch20-caching.ko.md',
    'book/02-fluoshop/ch21-commerce-caching.md',
    'book/02-fluoshop/ch21-commerce-caching.ko.md',
  ])('reports HTTP key strategy contract drift in %s', (driftedPath) => {
    const readWithoutKeyStrategyContract = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(HTTP_KEY_STRATEGY_CONTRACT, '')
        : read(relativePath);
    const runGovernanceGuard = () =>
      enforceCacheManagerNestjsMigrationDocs(readWithoutKeyStrategyContract);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(HTTP_KEY_STRATEGY_CONTRACT);
  });
});
