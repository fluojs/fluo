import { randomUUID } from 'node:crypto';

import * as core from '@fluojs/core';
import { describe, expect, it } from 'vitest';

import { Container } from './index.js';

describe('publicToken', () => {
  it('resolves an explicitly registered alias across independent token declarations', async () => {
    // Given
    class BlogService {
      title() {
        return 'FluoBlog';
      }
    }
    const namespace = `public-token-test/${randomUUID()}`;
    const exported = core.publicToken<BlogService>(namespace);
    const imported = core.publicToken<BlogService>(namespace);
    const container = new Container().register(
      BlogService,
      { provide: exported, useExisting: BlogService },
    );
    try {
      // When
      const service = await container.resolve(imported);

      // Then
      expect(service.title()).toBe('FluoBlog');
      expect(service).toBe(await container.resolve(BlogService));
      expect(imported).toBe(Symbol.for(namespace));
    } finally {
      await container.dispose();
    }
  });

  it('preserves string, symbol, and distinct same-named constructor identity', async () => {
    // Given
    const First = class Service {};
    const Second = class Service {};
    const symbol = Symbol('ordinary');
    const typed = core.publicToken<InstanceType<typeof First>>(randomUUID());
    const container = new Container().register(
      First,
      Second,
      { provide: typed, useExisting: First },
      { provide: 'ordinary', useExisting: First },
      { provide: symbol, useExisting: Second },
    );
    try {
      // When
      const [first, second, stringAlias, symbolAlias, publicAlias] = await Promise.all([
        container.resolve(First),
        container.resolve(Second),
        container.resolve('ordinary'),
        container.resolve(symbol),
        container.resolve(typed),
      ]);

      // Then
      expect(First.name).toBe(Second.name);
      expect(first).not.toBe(second);
      expect(stringAlias).toBe(first);
      expect(symbolAlias).toBe(second);
      expect(publicAlias).toBe(first);
    } finally {
      await container.dispose();
    }
  });

  it('keeps request values local when public tokens name request-scoped providers', async () => {
    // Given
    const token = core.publicToken<{ readonly actor: string }>(randomUUID());
    const root = new Container().register({
      provide: token, scope: 'request', useFactory: () => ({ actor: 'anonymous' }),
    });
    const alice = root.createRequestScope().override({ provide: token, useValue: { actor: 'alice' } });
    const bob = root.createRequestScope().override({ provide: token, useValue: { actor: 'bob' } });
    try {
      // When
      const values = await Promise.all([alice.resolve(token), bob.resolve(token)]);

      // Then
      expect(values.map((value) => value.actor)).toEqual(['alice', 'bob']);
      await expect(root.resolve(token)).rejects.toThrow();
      expect(core.publicToken<unknown>(randomUUID())).not.toBe(token);
    } finally {
      await root.dispose();
    }
  });
});
