import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceCacheManagerNestjsMigrationDocs } from './cache-manager-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
    ['packages/cache-manager/src/module.ts', "httpKeyStrategy: options.httpKeyStrategy ?? 'route'"],
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
});
