import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Source-of-truth markers for the cache-manager NestJS migration semantics.
// Each documentation marker below is an identifier, option value, or literal
// that a migrated application actually types, and every one of them is backed
// by the package source markers in the same list.
const requirements = [
  ['packages/cache-manager/src/module.ts', [
    "ttl: options.ttl ?? (store === 'memory' ? DEFAULT_MEMORY_STORE_TTL_SECONDS : 0)",
    'const DEFAULT_MEMORY_STORE_TTL_SECONDS = 300;',
    'global: options.global ?? false',
    "httpKeyStrategy: options.httpKeyStrategy ?? 'route'",
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
    "`httpKeyStrategy: 'route+query'`",
    '`isGlobal: true`',
    '`global: true`',
    '`cache-manager-redis-store`',
    '../../docs/getting-started/migrate-from-nestjs.md',
  ]],
  ['packages/cache-manager/README.ko.md', [
    '### NestJS 캐시 마이그레이션',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route+query'`",
    '`isGlobal: true`',
    '`global: true`',
    '`cache-manager-redis-store`',
    '../../docs/getting-started/migrate-from-nestjs.ko.md',
  ]],
  ['docs/getting-started/migrate-from-nestjs.md', [
    '### Cache-Manager TTL, Key, Visibility, and Store Ownership Migration',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route+query'`",
    '`CacheService.set(key, value, ttlSeconds)`',
    '`isGlobal`',
    '`global`',
    '`cache-manager-redis-store`',
    '`redis.client`',
  ]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', [
    '### Cache-Manager TTL, Key, Visibility, Store Ownership 마이그레이션',
    '`@CacheTTL(ttlSeconds: number)`',
    "`httpKeyStrategy: 'route+query'`",
    '`CacheService.set(key, value, ttlSeconds)`',
    '`isGlobal`',
    '`global`',
    '`cache-manager-redis-store`',
    '`redis.client`',
  ]],
  ['docs/CONTEXT.md', [
    'docs/getting-started/migrate-from-nestjs.md',
    '`@CacheTTL(...)` takes only a static number',
    '`httpKeyStrategy` defaults to path-only `route`',
  ]],
  ['docs/CONTEXT.ko.md', [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    '`@CacheTTL(...)`은 정적 숫자만 받고',
    'path만 사용하는 `route`가 기본값',
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
  }
}
