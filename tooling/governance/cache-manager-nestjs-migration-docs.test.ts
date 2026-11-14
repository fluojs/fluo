import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceCacheManagerNestjsMigrationDocs } from './verify-platform-consistency-governance.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_KEY_STRATEGY_CONTRACT =
  '<!-- fluo:cache-http-key-strategy: default=route+query;route=query-insensitive-opt-in;full=removed -->';
const OBSOLETE_ROUTE_DEFAULT_CLAIMS = [
  "httpKeyStrategy defaults to 'route'",
  "`httpKeyStrategy`의 기본값이 `'route'`",
] as const;

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

  describe.each([
    ['packages/cache-manager/README.md', '### NestJS Cache Migration'],
    ['packages/cache-manager/README.ko.md', '### NestJS 캐시 마이그레이션'],
    ['docs/getting-started/migrate-from-nestjs.md', '### Cache-Manager TTL, Key, Visibility, and Store Ownership Migration'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '### Cache-Manager TTL, Key, Visibility, Store Ownership 마이그레이션'],
  ])('unsupported migration boundaries in %s', (driftedPath, heading) => {
    it('rejects a migration heading at the wrong depth', () => {
      const readWithWrongHeadingDepth = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(`${heading}\n`, `#${heading}\n`)
          : read(relativePath);

      const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs(readWithWrongHeadingDepth);

      expect(runGovernanceGuard).toThrow(driftedPath);
      expect(runGovernanceGuard).toThrow(heading);
    });

    it('rejects a duplicate migration heading after a complete section', () => {
      const readWithDuplicateHeading = (relativePath: string): string => {
        const content = read(relativePath);
        if (relativePath !== driftedPath) {
          return content;
        }
        const section = content.split(`${heading}\n`)[1].split(/\n#{1,3} /u)[0];
        return content.replace(`${heading}\n${section}`, `${heading}\n${section}\n${heading}\n`);
      };

      const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs(readWithDuplicateHeading);

      expect(runGovernanceGuard).toThrow(driftedPath);
      expect(runGovernanceGuard).toThrow(heading);
    });

    it.each([
      ['decorator-placement', ['`@CacheTTL(...)`', '`@CacheKey(...)`']],
      ['store-configuration', ['`stores`', 'Keyv']],
      ['codemod', ['`fluo migrate`', '`@nestjs/cache-manager`']],
      ['transport', ['WebSocket', 'microservice', '`CacheService`']],
    ] as const)('rejects a %s boundary moved outside its owning section', (boundary, identifiers) => {
      const readWithMisplacedBoundary = (relativePath: string): string => {
        const content = read(relativePath);
        if (relativePath !== driftedPath) {
          return content;
        }
        const lines = content.split('\n');
        const isBoundary = (line: string) => identifiers.every((identifier) => line.includes(identifier));
        return [
          ...lines.filter((line) => !isBoundary(line)),
          '### Unrelated section',
          ...lines.filter(isBoundary),
        ].join('\n');
      };

      const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs(readWithMisplacedBoundary);

      expect(runGovernanceGuard).toThrow(driftedPath);
      expect(runGovernanceGuard).toThrow(boundary);
    });

    it.each([
      ['decorator-placement', /method-only|apply only to methods|method 전용|method에만/giu],
      ['store-configuration', /fallback/giu],
      ['codemod', /No manual follow-ups detected/gu],
      ['transport', /non-GET/gu],
    ] as const)('rejects a %s boundary with a missing contract term', (boundary, missingTerm) => {
      const readWithoutContractTerm = (relativePath: string): string =>
        relativePath === driftedPath ? read(relativePath).replace(missingTerm, '') : read(relativePath);

      const runGovernanceGuard = () => enforceCacheManagerNestjsMigrationDocs(readWithoutContractTerm);

      expect(runGovernanceGuard).toThrow(driftedPath);
      expect(runGovernanceGuard).toThrow(boundary);
    });
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

  it.each([
    'packages/cache-manager/README.md',
    'packages/cache-manager/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'book/01-fluoblog/ch20-caching.md',
    'book/01-fluoblog/ch20-caching.ko.md',
    'book/02-fluoshop/ch21-commerce-caching.md',
    'book/02-fluoshop/ch21-commerce-caching.ko.md',
  ])('rejects an obsolete route-default claim injected into %s', (driftedPath) => {
    const readWithObsoleteRouteDefaultClaim = (relativePath: string): string =>
      relativePath === driftedPath
        ? `${read(relativePath)}\n${OBSOLETE_ROUTE_DEFAULT_CLAIMS.join('\n')}`
        : read(relativePath);
    const runGovernanceGuard = () =>
      enforceCacheManagerNestjsMigrationDocs(readWithObsoleteRouteDefaultClaim);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(OBSOLETE_ROUTE_DEFAULT_CLAIMS[0]);
  });
});
