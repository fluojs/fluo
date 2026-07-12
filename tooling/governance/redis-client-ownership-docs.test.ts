import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
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
  });
});
