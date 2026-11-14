import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Redis from 'ioredis';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  CacheModule,
  type RedisAtomicClient,
  type RedisCacheOptions,
  type RedisCompatibleClient,
  RedisStore,
} from './index.js';

// Checked by the package's tsc invocation, never executed or connected to Redis.
function registerIoredisClient(cacheClient: Redis) {
  const client: RedisCompatibleClient = cacheClient;
  const options: RedisCacheOptions = { client: cacheClient };

  const readmeModule = CacheModule.forRoot({
    store: 'redis',
    keyPrefix: 'myapp:cache:',
    redis: { client: cacheClient },
  });
  const bookModule = CacheModule.forRoot({
    store: 'redis',
    keyPrefix: 'fluoblog:cache:',
    redis: { client: cacheClient },
  });
  const migrationModule = CacheModule.forRoot({
    ttl: 60,
    global: true,
    store: 'redis',
    redis: { client: cacheClient },
  });
  const asyncModule = CacheModule.forRootAsync({
    useFactory: async () => ({
      store: 'redis',
      keyPrefix: 'myapp:cache:',
      redis: { client: cacheClient, atomicUpdates: true },
    }),
  });
  const store = new RedisStore(cacheClient, {
    keyPrefix: 'myapp:cache:',
    atomicUpdates: true,
  });
  const scan: Promise<[string | number, string[]]> | [string | number, string[]] =
    client.scan('0', 'MATCH', 'myapp:cache:*', 'COUNT', 100);
  client.set('myapp:cache:entry', '{"value":1}');
  client.set('myapp:cache:entry', '{"value":1}', 'EX', 60);

  return { options, readmeModule, bookModule, migrationModule, asyncModule, store, scan };
}

describe('Redis client consumer compatibility', () => {
  it('direct registration: real ioredis types satisfy the public client and atomic seams', () => {
    expectTypeOf<Redis>().toExtend<RedisCompatibleClient>();
    expectTypeOf<Redis>().toExtend<NonNullable<RedisCacheOptions['client']>>();
    expectTypeOf<Redis>().toExtend<RedisAtomicClient>();
    expectTypeOf<Redis['duplicate']>().toExtend<NonNullable<RedisCompatibleClient['duplicate']>>();
    expectTypeOf(registerIoredisClient).parameter(0).toEqualTypeOf<Redis>();
  });

  it('client contract: all ordinary Redis operations remain required', () => {
    expectTypeOf<Omit<RedisCompatibleClient, 'get'>>().not.toExtend<RedisCompatibleClient>();
    expectTypeOf<Omit<RedisCompatibleClient, 'set'>>().not.toExtend<RedisCompatibleClient>();
    expectTypeOf<Omit<RedisCompatibleClient, 'del'>>().not.toExtend<RedisCompatibleClient>();
    expectTypeOf<Omit<RedisCompatibleClient, 'scan'>>().not.toExtend<RedisCompatibleClient>();
  });

  it('documented direct clients: all six EN/KO snippets compile against the public API', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const documents = [
      'packages/cache-manager/README.md',
      'packages/cache-manager/README.ko.md',
      'docs/getting-started/migrate-from-nestjs.md',
      'docs/getting-started/migrate-from-nestjs.ko.md',
      'book/beginner/ch17-cache.md',
      'book/beginner/ch17-cache.ko.md',
    ];
    const sources = new Map<string, string>();
    for (const [index, document] of documents.entries()) {
      const markdown = readFileSync(join(repoRoot, document), 'utf8');
      const snippets = [...markdown.matchAll(/```(?:typescript|ts)\n([\s\S]*?)```/g)]
        .map((match) => match[1])
        .filter((source) => source.includes("import Redis from") && source.includes('redis: { client: cacheClient }'));
      expect(snippets, document).toHaveLength(1);
      sources.set(join(packageRoot, `src/redis-doc-${index}.ts`), snippets[0]);
    }
    const config = ts.readConfigFile(join(packageRoot, 'tsconfig.json'), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
    expect(parsed.errors).toEqual([]);
    const options: ts.CompilerOptions = {
      ...parsed.options,
      noEmit: true,
      paths: { '@fluojs/cache-manager': [join(packageRoot, 'src/index.ts')] },
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = sources.get(path);
      return source === undefined
        ? originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(path, source, languageVersion, true);
    };

    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host));

    expect(ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n',
    })).toBe('');
  });

  it.each([0, '0'])('reset: legacy synchronous cursor %j preserves broad rest client compatibility', async (cursor) => {
    const client = {
      get: (_key: string): string | null => null,
      set: (_key: string, _value: string, ..._args: Array<string | number>) => 'OK',
      del: vi.fn((_key: string, ..._keys: string[]) => 1),
      scan: vi.fn((_cursor: string, ..._args: Array<string | number>): [string | number, string[]] =>
        [cursor, ['cache:entry']]),
    } satisfies RedisCompatibleClient;
    const store = new RedisStore(client, { keyPrefix: 'cache:', scanCount: 25 });

    await store.reset();

    expect(client.scan).toHaveBeenCalledExactlyOnceWith('0', 'MATCH', 'cache:*', 'COUNT', 25);
    expect(client.del).toHaveBeenCalledExactlyOnceWith('cache:entry');
  });

  it('reset: legacy async tuple client remains compatible without duplicate', async () => {
    const client = {
      get: async (_key: string): Promise<string | null> => null,
      set: async (_key: string, _value: string, ..._args: Array<string | number>) => 'OK',
      del: vi.fn(async (_key: string, ..._keys: string[]) => 1),
      scan: vi.fn(async (_cursor: string, ..._args: Array<string | number>): Promise<[string | number, string[]]> =>
        ['0', ['cache:entry']]),
    } satisfies RedisCompatibleClient;
    const store = new RedisStore(client, { keyPrefix: 'cache:', scanCount: 25 });

    await store.reset();

    expect(client.scan).toHaveBeenCalledExactlyOnceWith('0', 'MATCH', 'cache:*', 'COUNT', 25);
    expect(client.del).toHaveBeenCalledExactlyOnceWith('cache:entry');
  });
});
