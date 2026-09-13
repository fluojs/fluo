import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTTP_KEY_STRATEGY_CONTRACT =
  '<!-- fluo:cache-http-key-strategy: default=route+query;route=query-insensitive-opt-in;full=removed -->';
const OBSOLETE_ROUTE_DEFAULT_CLAIMS = [
  "httpKeyStrategy defaults to 'route'",
  "`httpKeyStrategy`의 기본값이 `'route'`",
];

// Source-of-truth markers for the cache-manager NestJS migration semantics.
// Each documentation marker below is an identifier, option value, or literal
// that a migrated application actually types, and every one of them is backed
// by the package source markers in the same list.
const requirements = [
  ['packages/cache-manager/src/module.ts', [
    "ttl: options.ttl ?? (store === 'memory' ? DEFAULT_MEMORY_STORE_TTL_SECONDS : 0)",
    'const DEFAULT_MEMORY_STORE_TTL_SECONDS = 300;',
    "const DEFAULT_HTTP_KEY_STRATEGY: CacheKeyStrategy = 'route+query';",
    'global: options.global ?? false',
    'httpKeyStrategy: normalizeHttpKeyStrategy(options.httpKeyStrategy)',
    'function isCacheKeyStrategy(strategy: unknown): strategy is CacheKeyStrategy',
    'function normalizeHttpKeyStrategy(strategy: unknown): CacheKeyStrategy',
    "return strategy === 'route' || strategy === 'route+query' || typeof strategy === 'function';",
  ]],
  ['packages/cache-manager/src/decorators.ts', ['export function CacheTTL(ttlSeconds: number): StandardMethodDecoratorFn']],
  ['packages/cache-manager/src/interceptor.ts', [
    'function normalizeTtl(ttlSeconds: number | undefined, fallback: number): number | undefined',
    'if (!Number.isFinite(candidate) || candidate < 0)',
    "if (strategy === 'route')",
  ]],
  ['packages/cache-manager/src/service.ts', ['if (this.closed || !Number.isFinite(resolvedTtl) || resolvedTtl < 0)']],
  ['packages/cache-manager/src/types.ts', [
    'global?: boolean;',
    "store?: 'memory' | 'redis' | CacheStore;",
    'close?(): Awaitable<void>;',
    'dispose?(): Awaitable<void>;',
  ]],
  ['packages/cache-manager/README.md', [
    '### NestJS Cache Migration',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route'`",
    '`isGlobal: true`',
    '`global: true`',
    '`cache-manager-redis-store`',
    '../../docs/getting-started/migrate-from-nestjs.md',
    HTTP_KEY_STRATEGY_CONTRACT,
  ]],
  ['packages/cache-manager/README.ko.md', [
    '### NestJS 캐시 마이그레이션',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route'`",
    '`isGlobal: true`',
    '`global: true`',
    '`cache-manager-redis-store`',
    '../../docs/getting-started/migrate-from-nestjs.ko.md',
    HTTP_KEY_STRATEGY_CONTRACT,
  ]],
  ['docs/getting-started/migrate-from-nestjs.md', [
    '### Cache-Manager TTL, Key, Visibility, and Store Ownership Migration',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route'`",
    '`CacheService.set(key, value, ttlSeconds)`',
    '`isGlobal`',
    '`global`',
    '`cache-manager-redis-store`',
    '`redis.client`',
    HTTP_KEY_STRATEGY_CONTRACT,
  ]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', [
    '### Cache-Manager TTL, Key, Visibility, Store Ownership 마이그레이션',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route'`",
    '`CacheService.set(key, value, ttlSeconds)`',
    '`isGlobal`',
    '`global`',
    '`cache-manager-redis-store`',
    '`redis.client`',
    HTTP_KEY_STRATEGY_CONTRACT,
  ]],
  ['book/01-fluoblog/ch20-caching.md', [HTTP_KEY_STRATEGY_CONTRACT]],
  ['book/01-fluoblog/ch20-caching.ko.md', [HTTP_KEY_STRATEGY_CONTRACT]],
  ['book/02-fluoshop/ch21-commerce-caching.md', [HTTP_KEY_STRATEGY_CONTRACT]],
  ['book/02-fluoshop/ch21-commerce-caching.ko.md', [HTTP_KEY_STRATEGY_CONTRACT]],
  ['docs/CONTEXT.md', [
    'docs/getting-started/migrate-from-nestjs.md',
    '`@CacheTTL(...)` takes only a static number',
    '`httpKeyStrategy` defaults to query-aware `route+query`',
  ]],
  ['docs/CONTEXT.ko.md', [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    '`@CacheTTL(...)`은 정적 숫자만 받고',
    '`httpKeyStrategy`의 기본값은 query-aware `route+query`',
  ]],
];

export function enforceCacheManagerNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the @nestjs/cache-manager migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }

    const obsoleteRouteDefaultClaim = OBSOLETE_ROUTE_DEFAULT_CLAIMS.find((claim) => content.includes(claim));

    if (obsoleteRouteDefaultClaim !== undefined) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must not claim the obsolete route default; found: ${obsoleteRouteDefaultClaim}.`,
      );
    }
  }
}
