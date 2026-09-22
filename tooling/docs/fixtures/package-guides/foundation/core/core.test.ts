import { getModuleMetadata, Inject, Module } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { describe, expect, it } from 'vitest';
import { POSTS_READER, type PostsReader } from './posts.contract';
import { PostsModule } from './posts.module';
import { AuditLog, PostsService } from './posts.service';

/**
 * @fluojs/core guide evidence: decorator metadata, publicToken identity,
 * the removed array-form Inject rejection, and read-only metadata snapshots.
 */

describe('@fluojs/core guide examples', () => {
  it('records module metadata readable through getModuleMetadata', () => {
    const metadata = getModuleMetadata(PostsModule);

    expect(metadata).toBeDefined();
    expect(metadata?.providers).toContain(PostsService);
    expect(metadata?.providers).toContain(AuditLog);
    expect(metadata?.exports).toContain(POSTS_READER);
    expect(Object.isFrozen(metadata)).toBe(true);
  });

  it('merges stacked @Module declarations and keeps empty-module shorthand', () => {
    @Module({ global: true })
    @Module()
    class MergedModule {}

    const metadata = getModuleMetadata(MergedModule);
    expect(metadata?.global).toBe(true);
    expect(metadata?.providers).toBeUndefined();
  });

  it('keeps publicToken identity through the global symbol registry', () => {
    expect(POSTS_READER).toBe(Symbol.for('my-blog/posts/v1'));
    expect(Symbol.for('my-blog/posts/v1')).toBe(POSTS_READER);
  });

  it('rejects the removed array form of Inject with TypeError', () => {
    // The array form is also a compile-time error; the runtime rejection is
    // exercised here through Reflect.apply so the fixture typechecks.
    const callWithArrayToken = (): unknown => Reflect.apply(Inject, undefined, [[AuditLog]]);
    expect(callWithArrayToken).toThrow(TypeError);
    expect(callWithArrayToken).toThrow(/spread/i);
  });

  it('resolves the published contract token through DI without exporting the class', async () => {
    // A fresh container proves the alias resolves the PostsService instance
    // under the contract token, typed as PostsReader.
    const container = new Container().register(AuditLog, PostsService, {
      provide: POSTS_READER,
      useExisting: PostsService,
    });
    try {
      // The contract token resolves the PostsService instance with the
      // PostsReader type carried by publicToken.
      const reader: PostsReader = await container.resolve(POSTS_READER);
      const service = await container.resolve(PostsService);

      service.create('from contract token');
      expect(reader.list()).toEqual(['created: from contract token']);
    } finally {
      await container.dispose();
    }
  });
});
