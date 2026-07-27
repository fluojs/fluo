import { describe, expect, it } from 'vitest';

import type { RedisCompatibleClient } from '../types.js';
import { RedisStore } from './redis-store.js';

const LITERAL_PREFIX = 'cache[tenant]*?\\:';
const ESCAPED_SCAN_PATTERN = 'cache\\[tenant\\]\\*\\?\\\\:*';
const OWNED_KEY = `${LITERAL_PREFIX}owned`;
const NON_OWNED_GLOB_MATCH = 'cachetother:outside';

class NamespaceSensitiveRedisClient implements RedisCompatibleClient {
  readonly deletedKeys: string[][] = [];
  readonly scanPatterns: string[] = [];

  del(key: string, ...keys: string[]): number {
    this.deletedKeys.push([key, ...keys]);
    return keys.length + 1;
  }

  get(): null {
    return null;
  }

  scan(_cursor: string, ...args: Array<string | number>): [string, string[]] {
    const matchIndex = args.indexOf('MATCH');
    const pattern = args[matchIndex + 1];

    if (typeof pattern !== 'string') {
      return ['0', []];
    }

    this.scanPatterns.push(pattern);

    return pattern === ESCAPED_SCAN_PATTERN
      ? ['0', [OWNED_KEY]]
      : ['0', [OWNED_KEY, NON_OWNED_GLOB_MATCH]];
  }

  set(): 'OK' {
    return 'OK';
  }
}

describe('RedisStore namespace reset regression', () => {
  it('treats Redis glob metacharacters in keyPrefix as literal namespace characters', async () => {
    // Given
    const client = new NamespaceSensitiveRedisClient();
    const store = new RedisStore(client, { keyPrefix: LITERAL_PREFIX });

    // When
    await store.reset();

    // Then
    expect(client.scanPatterns).toEqual([ESCAPED_SCAN_PATTERN]);
    expect(client.deletedKeys).toEqual([[OWNED_KEY]]);
  });
});
