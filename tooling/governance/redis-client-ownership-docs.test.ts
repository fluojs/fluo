import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function getOwningModuleBlock(content: string, factoryName: string): string {
  const factoryDeclarationIndex = content.indexOf(`export class ${factoryName} {`);
  const moduleDeclarationIndex = content.indexOf('@Module({', factoryDeclarationIndex);
  const moduleEndIndex = content.indexOf('\n})', moduleDeclarationIndex);

  expect(
    factoryDeclarationIndex,
    `must declare ${factoryName} before its owning module`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    moduleDeclarationIndex,
    `must declare an owning module after ${factoryName}`,
  ).toBeGreaterThan(factoryDeclarationIndex);
  expect(moduleEndIndex, `must close the owning module for ${factoryName}`).toBeGreaterThan(
    moduleDeclarationIndex,
  );

  return content.slice(moduleDeclarationIndex, moduleEndIndex + '\n})'.length);
}

describe('Redis client ownership documentation', () => {
  it('keeps client construction and raw Pub/Sub cleanup ownership aligned across companion docs', () => {
    const failureSafeShutdown = `  const shutdownErrors: unknown[] = [];

  for (const shutdown of [
    () => transport.close(),
    () => subscriber.quit(),
    () => publisher.quit(),
  ]) {
    try {
      await shutdown();
    } catch (error) {
      shutdownErrors.push(error);
    }
  }

  if (shutdownErrors.length > 0) {
    throw new AggregateError(shutdownErrors, 'Failed to close Redis notification transport.');
  }`;

    expect(read('packages/redis/README.md')).toContain('does not adopt an externally constructed client');
    expect(read('packages/redis/README.ko.md')).toContain('외부에서 만든 client를 채택하지 않습니다');
    expect(read('book/intermediate/ch03-redis-transport.md')).toContain('Closing the transport only unsubscribes the subscriber');
    expect(read('book/intermediate/ch03-redis-transport.ko.md')).toContain('Transport를 닫아도 subscriber 구독만 해제되므로');
    expect(read('book/intermediate/ch03-redis-transport.md')).toContain(failureSafeShutdown);
    expect(read('book/intermediate/ch03-redis-transport.ko.md')).toContain(failureSafeShutdown);
    expect(read('docs/getting-started/migrate-from-nestjs.md')).toContain('rather than accepting or adopting an external client');
    expect(read('docs/getting-started/migrate-from-nestjs.ko.md')).toContain('외부 client를 받거나 채택하지 않고');
    expect(read('docs/CONTEXT.md')).toContain('Each `RedisModule.forRoot(...)` registration creates a new client');
    expect(read('docs/CONTEXT.ko.md')).toContain('각 `RedisModule.forRoot(...)` 등록은 최종 option으로 새 client를 생성');
    expect(read('docs/CONTEXT.md')).toContain(
      'Every named-token consumer must still be explicitly declared',
    );
    expect(read('docs/CONTEXT.ko.md')).toContain(
      'named token consumer는 importing module의 `providers`에 나열하기 전에 명시적으로 선언해야',
    );
  });

  it('registers named-token Pub/Sub factories in the owning module providers', () => {
    const namedTokenFactoryExamples: ReadonlyArray<readonly [string, string]> = [
      ['packages/redis/README.md', 'PubSubTransportFactory'],
      ['packages/redis/README.ko.md', 'PubSubTransportFactory'],
      ['book/intermediate/ch03-redis-transport.md', 'NotificationTransportFactory'],
      ['book/intermediate/ch03-redis-transport.ko.md', 'NotificationTransportFactory'],
    ];

    for (const [relativePath, factoryName] of namedTokenFactoryExamples) {
      const content = read(relativePath);
      const moduleBlock = getOwningModuleBlock(content, factoryName);

      expect(content, `${relativePath} must declare ${factoryName}`).toContain(
        `export class ${factoryName} {`,
      );
      expect(moduleBlock, `${relativePath} must import Redis registrations`).toContain(
        'RedisModule.forRoot(',
      );
      expect(moduleBlock, `${relativePath} must register ${factoryName} as a provider`).toContain(
        `  providers: [${factoryName}],`,
      );
    }
  });

  it('states that named-token Redis consumers need explicit provider registration in the migration row', () => {
    expect(read('docs/getting-started/migrate-from-nestjs.md')).toContain(
      'Register every `getRedisClientToken(name)` consumer in the importing module graph',
    );
    expect(read('docs/getting-started/migrate-from-nestjs.ko.md')).toContain(
      '`getRedisClientToken(name)` consumer는 importing module graph의 `providers`에 명시적으로 등록',
    );
  });
});
